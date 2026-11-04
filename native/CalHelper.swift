// Reads Apple Calendar and Reminders for Homework's Calendar tab, and keeps Homework's tasks in a
// "Homework" Reminders list so they reach the iPhone through iCloud. It never writes anywhere else.
// Talks JSON lines over stdin/stdout: {"id","start","end"} in, events and reminders out;
// {"id","op":"sync",...} in, what changed out; plus an unprompted {"changed":true} whenever Calendar or Reminders change.
import CoreGraphics
import EventKit
import Foundation

let store = EKEventStore()
let out = DispatchQueue(label: "out")
let iso = ISO8601DateFormatter()
let isoMs: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions.insert(.withFractionalSeconds); return f }()
func parseDate(_ s: String) -> Date? { iso.date(from: s) ?? isoMs.date(from: s) } // JS toISOString() adds .000
let LIST = "Homework"
var quietUntil = Date.distantPast // our own saves also fire change notices; don't echo those back

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
  out.sync { print(line); fflush(stdout) }
}

func hex(_ color: CGColor?) -> String? {
  guard let c = color?.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil),
        let p = c.components, p.count >= 3 else { return nil }
  return String(format: "#%02X%02X%02X", Int(p[0] * 255), Int(p[1] * 255), Int(p[2] * 255))
}

// Asks once (macOS shows its prompt), then answers from the saved choice
func access(_ type: EKEntityType) -> String {
  switch EKEventStore.authorizationStatus(for: type) {
  case .fullAccess: return "granted"
  case .notDetermined: break
  default: return "denied"
  }
  let wait = DispatchSemaphore(value: 0)
  var ok = false
  let done: EKEventStoreRequestAccessCompletionHandler = { granted, _ in ok = granted; wait.signal() }
  if type == .event { store.requestFullAccessToEvents(completion: done) } else { store.requestFullAccessToReminders(completion: done) }
  wait.wait()
  if ok { store.reset() }
  return ok ? "granted" : "denied"
}

// The saved choice only, never a prompt: syncing runs at login, the prompt belongs to the Calendar tab
func status(_ type: EKEntityType) -> String {
  switch EKEventStore.authorizationStatus(for: type) {
  case .fullAccess: return "granted"
  case .notDetermined: return "undetermined"
  default: return "denied"
  }
}

func events(_ start: Date, _ end: Date) -> [[String: Any]] {
  store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil)).map { e in
    ["id": e.eventIdentifier ?? UUID().uuidString, "title": e.title ?? "", "start": iso.string(from: e.startDate),
     "end": iso.string(from: e.endDate), "allDay": e.isAllDay, "calendar": e.calendar.title, "color": hex(e.calendar.cgColor) ?? ""]
  }
}

func fetch(_ predicate: NSPredicate) -> [EKReminder] {
  let wait = DispatchSemaphore(value: 0)
  var found: [EKReminder] = []
  store.fetchReminders(matching: predicate) { found = $0 ?? []; wait.signal() }
  wait.wait()
  return found
}

// Homework's own tasks are left out: they're already in the app
func reminders(_ start: Date, _ end: Date, skip: String?) -> [[String: Any]] {
  fetch(store.predicateForIncompleteReminders(withDueDateStarting: start, ending: end, calendars: nil)).compactMap { r in
    guard r.calendar.calendarIdentifier != skip, r.url?.scheme != "homework", let comps = r.dueDateComponents, let due = Calendar.current.date(from: comps) else { return nil }
    return ["id": r.calendarItemIdentifier, "title": r.title ?? "", "due": iso.string(from: due), "hasTime": comps.hour != nil,
            "list": r.calendar.title, "color": hex(r.calendar.cgColor) ?? ""]
  }
}

func homeworkList(_ savedId: String?) throws -> EKCalendar {
  // The saved list only counts while it's still called "Homework": a renamed list is the user's now
  if let id = savedId, let c = store.calendar(withIdentifier: id), c.title == LIST, c.allowsContentModifications { return c }
  if let c = store.calendars(for: .reminder).first(where: { $0.title == LIST && $0.allowsContentModifications }) { return c }
  let c = EKCalendar(for: .reminder, eventStore: store)
  c.title = LIST
  // Same account as the user's other lists (iCloud, so it reaches the phone)
  guard let source = store.defaultCalendarForNewReminders()?.source else { throw NSError(domain: "Homework", code: 1) }
  c.source = source
  try store.saveCalendar(c, commit: true)
  return c
}

let day = DateFormatter()
day.dateFormat = "yyyy-MM-dd"
day.calendar = Calendar(identifier: .gregorian)

// Phone alert at the same time as the Mac's: 7pm the evening before, or 7am on the day if that has passed
func alarms(_ due: Date) -> [EKAlarm] {
  let cal = Calendar.current
  let eve = cal.date(bySettingHour: 19, minute: 0, second: 0, of: cal.date(byAdding: .day, value: -1, to: due)!)!
  let morning = cal.date(bySettingHour: 7, minute: 0, second: 0, of: due)!
  return [eve, morning].first(where: { $0 > Date() }).map { [EKAlarm(absoluteDate: $0)] } ?? []
}

// Brings the Homework list in line with the app's tasks. A tick made in Reminders since the last sync
// (its state differs from "synced" while the task's doesn't) is reported back instead of being undone.
func sync(_ req: [String: Any]) throws -> [String: Any] {
  let list = try homeworkList(req["listId"] as? String)
  let tasks = req["tasks"] as? [[String: Any]] ?? []
  let mine = fetch(store.predicateForReminders(in: [list]))
  var byRid: [String: EKReminder] = [:], byTask: [String: EKReminder] = [:]
  for r in mine {
    byRid[r.calendarItemIdentifier] = r
    if let u = r.url, u.scheme == "homework" { byTask[u.lastPathComponent] = r }
  }
  var synced: [String: Any] = [:], remote: [String: Bool] = [:], kept = Set<String>(), wrote = false
  for t in tasks {
    guard let id = t["id"] as? String, let dueStr = t["due"] as? String, let due = day.date(from: dueStr) else { continue }
    let done = t["done"] as? Bool ?? false, last = t["synced"] as? Bool
    var r = (t["rid"] as? String).flatMap { byRid[$0] } ?? byTask[id]
    if r == nil {
      if done { continue } // finished before syncing began: nothing to remind about
      let n = EKReminder(eventStore: store)
      n.calendar = list
      n.url = URL(string: "homework://task/\(id)")
      r = n
    }
    let rem = r!
    var final = done
    if let last, rem.isCompleted != last, done == last { final = rem.isCompleted; remote[id] = final }
    let title = t["title"] as? String ?? "", notes = t["notes"] as? String ?? ""
    let want = Calendar.current.dateComponents([.year, .month, .day], from: due)
    let had = rem.dueDateComponents.map { ($0.year, $0.month, $0.day) }
    var changed = rem.isNew
    if rem.title != title { rem.title = title; changed = true }
    if (rem.notes ?? "") != notes { rem.notes = notes.isEmpty ? nil : notes; changed = true }
    if had == nil || had! != (want.year, want.month, want.day) {
      rem.dueDateComponents = want
      rem.alarms = alarms(due)
      changed = true
    }
    if rem.isCompleted != final { rem.isCompleted = final; changed = true }
    if changed { try store.save(rem, commit: false); wrote = true }
    kept.insert(rem.calendarItemIdentifier)
    synced[id] = ["rid": rem.calendarItemIdentifier, "done": final]
  }
  // Deleted tasks: their reminders go too. Reminders the user added to the list by hand are left alone.
  let gone = Set(req["remove"] as? [String] ?? [])
  for r in mine where !kept.contains(r.calendarItemIdentifier) && (gone.contains(r.calendarItemIdentifier) || r.url?.scheme == "homework") {
    try store.remove(r, commit: false); wrote = true
  }
  if wrote { quietUntil = Date().addingTimeInterval(2); try store.commit() }
  return ["listId": list.calendarIdentifier, "synced": synced, "remote": remote]
}

NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: nil) { _ in
  if Date() > quietUntil { emit(["changed": true]) }
}

Thread {
  while let line = readLine() {
    guard let req = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any], let id = req["id"] else { continue }
    if req["op"] as? String == "sync" {
      let rem = status(.reminder)
      guard rem == "granted" else { emit(["id": id, "access": rem]); continue }
      do { emit((try sync(req)).merging(["id": id, "access": rem]) { a, _ in a }) }
      catch { store.reset(); emit(["id": id, "access": rem, "error": "\(error.localizedDescription)"]) }
      continue
    }
    guard let s = req["start"] as? String, let e = req["end"] as? String, let start = parseDate(s), let end = parseDate(e) else {
      emit(["id": id, "error": "bad range"]); continue
    }
    let cal = access(.event), rem = access(.reminder)
    emit(["id": id, "access": ["calendar": cal, "reminders": rem],
          "events": cal == "granted" ? events(start, end) : [], "reminders": rem == "granted" ? reminders(start, end, skip: req["skipList"] as? String) : []])
  }
  exit(0) // Homework quit
}.start()

dispatchMain()
