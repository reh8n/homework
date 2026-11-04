const COLORS = ['#8FA9C9', '#A9C2A4', '#D3B58C', '#C9A0B4', '#A79CC9', '#9FC4C4', '#C9A09A'];
const DAY = 86400000;
const SETTLE = 550; // let the tick and strike finish drawing before the row leaves its view
const HOUR = 44; // px per hour in the calendar grid

let data = { tasks: [], subjects: [], settings: {}, timetable: [], meetings: [] };
let view = 'today';
let group = 'date';
let editing = null;
let lastView = null;
const leaving = new Map(); // task id -> timer for a row about to move between the list and Done
let weekStart = null; // Monday of the week the calendar shows
let cal = { week: null, access: null, events: [], reminders: [], error: null }; // last read of Apple Calendar and Reminders
let slotEditing = null;

const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
const ENTER = [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }];

const $ = id => document.getElementById(id);
const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => localDate(new Date());
const dayDiff = iso => Math.round((new Date(iso + 'T00:00') - new Date(today() + 'T00:00')) / DAY);
const subjectColor = name => (data.subjects.find(s => s.name === name) || {}).color || 'transparent';
const save = () => window.store.save(data);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style') n.style.cssText = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.filter(k => k != null));
  return n;
}

function tick() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M2.5 6.2 5 8.6 9.6 3.6');
  path.setAttribute('pathLength', '1');
  svg.append(path);
  return svg;
}

// Slide a highlight (.thumb) under the chosen item; jumps without animating the first time
function placeThumb(thumb, target) {
  if (!thumb || !target || !target.offsetWidth) return;
  const instant = !thumb.dataset.ready || !motion();
  if (instant) thumb.style.transition = 'none';
  thumb.style.width = target.offsetWidth + 'px';
  thumb.style.height = target.offsetHeight + 'px';
  thumb.style.transform = `translate(${target.offsetLeft}px, ${target.offsetTop}px)`;
  if (instant) { thumb.offsetWidth; thumb.style.transition = ''; thumb.dataset.ready = 1; }
}

function syncThumbs() {
  placeThumb(document.querySelector('.nav-thumb'), document.querySelector('.nav.active'));
  document.querySelectorAll('.pill-toggle').forEach(p => placeThumb(p.querySelector('.thumb'), p.querySelector('button.on')));
}

function dueLabel(iso) {
  const d = dayDiff(iso);
  if (d < 0) return `${-d}d late`;
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d < 7) return new Date(iso + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(iso + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function isArchived(t) {
  return t.done;
}

function visibleTasks() {
  const active = data.tasks.filter(t => !isArchived(t));
  if (view === 'today') return active.filter(t => dayDiff(t.due) <= 0);
  if (view === 'upcoming') return active.filter(t => dayDiff(t.due) > 0);
  if (view === 'done') return data.tasks.filter(isArchived);
  return [];
}

function groupTasks(tasks) {
  const groups = new Map();
  const add = (key, t) => (groups.get(key) || groups.set(key, []).get(key)).push(t);
  tasks.sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
  if (view === 'done') tasks.reverse();

  for (const t of tasks) {
    if (group === 'subject') { add(t.subject || 'No subject', t); continue; }
    if (view === 'done') { add('Completed', t); continue; }
    const d = dayDiff(t.due);
    add(d < 0 ? 'Overdue' : d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : d < 7 ? 'This week' : 'Later', t);
  }
  const order = ['Overdue', 'Today', 'Tomorrow', 'This week', 'Later'];
  return [...groups].sort(([a], [b]) => group === 'date' ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b));
}

function taskRow(t) {
  const row = el('div', { class: 'task' + (t.done ? ' done' : ''), 'data-id': t.id, ondblclick: () => openEdit(t) },
    el('button', { class: 'check', title: 'Done', onclick: () => toggle(t, row) }, tick()),
    el('span', { class: 'name' }, el('span', { class: 'strike' }, t.title)),
    el('span', { class: 'meta' },
      t.notes ? el('span', { class: 'note-mark', title: t.notes }, '✎') : null,
      el('span', { class: 'chip' }, t.type),
      t.subject ? el('span', { class: 'dot', style: `background:${subjectColor(t.subject)}`, title: t.subject }) : null,
      el('span', {}, dueLabel(t.due))
    )
  );
  return row;
}

// mode: 'enter' staggers rows in, 'flip' glides kept rows to their new spot and folds removed ones away
function renderList(mode) {
  const list = $('list');
  const before = new Map();
  const oldHeads = new Set([...list.querySelectorAll('h2')].map(h => h.textContent));
  for (const row of list.querySelectorAll('.task[data-id]')) before.set(row.dataset.id, { row, rect: row.getBoundingClientRect() });
  list.replaceChildren();
  build(list);
  if (!motion() || mode === 'none') return;

  const rows = [...list.querySelectorAll('.task[data-id]')];
  if (mode === 'enter') {
    rows.forEach((r, i) => r.animate(ENTER, { duration: 300, easing: EASE, delay: Math.min(i, 12) * 22, fill: 'backwards' }));
    return;
  }
  for (const r of rows) {
    const old = before.get(r.dataset.id);
    before.delete(r.dataset.id);
    if (!old) { r.animate(ENTER, { duration: 280, easing: EASE }); continue; }
    const now = r.getBoundingClientRect();
    const dx = old.rect.left - now.left, dy = old.rect.top - now.top;
    if (dx || dy) r.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 320, easing: EASE });
  }
  for (const h of list.querySelectorAll('h2')) if (!oldHeads.has(h.textContent)) h.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 280, easing: EASE });
  const box = list.getBoundingClientRect();
  for (const { row, rect } of before.values()) {
    row.removeAttribute('data-id');
    row.style.cssText = `position:absolute;left:${rect.left - box.left}px;top:${rect.top - box.top}px;width:${rect.width}px;pointer-events:none`;
    list.append(row);
    row.animate([{ opacity: row.classList.contains('done') ? .6 : 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }],
      { duration: 220, easing: EASE, fill: 'forwards' }).onfinish = () => row.remove();
  }
}

function build(list) {
  const groups = groupTasks(visibleTasks());
  if (!groups.length) {
    const msg = { today: 'Nothing due today.', upcoming: 'Nothing coming up.', done: 'No finished tasks yet.' }[view];
    list.append(el('p', { class: 'empty' }, msg));
    return;
  }
  for (const [name, tasks] of groups) {
    list.append(el('div', { class: 'group' },
      el('h2', { class: name === 'Overdue' ? 'late' : '' }, name),
      ...tasks.map(taskRow)
    ));
  }
}

function renderSubjects() {
  const box = $('subjectsView');
  box.replaceChildren();
  for (const s of data.subjects) {
    const count = data.tasks.filter(t => t.subject === s.name && !t.done).length;
    box.append(el('div', { class: 'subject-row' },
      el('span', { class: 'dot', style: `background:${s.color}` }),
      el('input', { class: 'name rename', value: s.name, title: 'Click to rename', onchange: e => renameSubject(s, e.target) }),
      el('span', { class: 'meta' }, `${count} open`),
      el('div', { class: 'swatches' }, ...COLORS.map(c =>
        el('button', { class: c === s.color ? 'sel' : '', style: `background:${c}`, onclick: () => { s.color = c; save(); render(); } })
      )),
      el('button', { class: 'soft', onclick: () => removeSubject(s) }, 'Remove')
    ));
  }
  const input = el('input', { class: 'field grow', placeholder: 'New subject, e.g. Maths' });
  const form = el('form', { class: 'add-subject', onsubmit: e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name || data.subjects.some(s => s.name.toLowerCase() === name.toLowerCase())) return;
    data.subjects.push({ name, color: COLORS[data.subjects.length % COLORS.length] });
    save(); render();
  } }, input, el('button', { class: 'round', type: 'submit', title: 'Add subject' }, '+'));
  box.append(form);
  if (!data.subjects.length) input.focus();
}

function renameSubject(s, input) {
  const name = input.value.trim();
  if (!name || data.subjects.some(x => x !== s && x.name.toLowerCase() === name.toLowerCase())) { input.value = s.name; return; }
  data.tasks.forEach(t => { if (t.subject === s.name) t.subject = name; });
  s.name = name;
  save(); render();
}

function applyTheme() {
  const mode = data.settings.theme || 'system';
  if (mode === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  window.store.setTheme(mode);
  document.querySelectorAll('#themeToggle button').forEach(b => b.classList.toggle('on', b.dataset.theme === mode));
  syncThumbs();
}

function removeSubject(s) {
  if (!confirm(`Remove "${s.name}"? Its tasks will keep their titles but lose the subject.`)) return;
  data.subjects = data.subjects.filter(x => x !== s);
  data.tasks.forEach(t => { if (t.subject === s.name) t.subject = ''; });
  save(); render();
}

function fillSubjectSelect(select, value = '') {
  select.replaceChildren(el('option', { value: '' }, 'No subject'),
    ...data.subjects.map(s => el('option', { value: s.name }, s.name)));
  select.value = value;
}

function render() {
  const subjects = view === 'subjects';
  const settings = view === 'settings';
  const calendar = view === 'calendar';
  const page = subjects || settings || calendar;
  $('title').textContent = { today: 'Today', upcoming: 'Upcoming', calendar: 'Calendar', done: 'Done', subjects: 'Subjects', settings: 'Settings' }[view];
  $('eyebrow').textContent = calendar ? weekLabel() : new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('list').hidden = page;
  $('subjectsView').hidden = !subjects;
  $('settingsView').hidden = !settings;
  $('calendarView').hidden = !calendar;
  $('groupToggle').classList.toggle('gone', page);
  $('weekNav').classList.toggle('gone', !calendar);
  $('addForm').classList.toggle('gone', page || view === 'done');
  $('calForm').classList.toggle('gone', !calendar);
  document.querySelectorAll('.nav').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('#groupToggle button').forEach(b => b.classList.toggle('on', b.dataset.group === group));

  const keep = $('fSubject').value;
  fillSubjectSelect($('fSubject'), keep);
  const first = lastView === null, moved = !first && view !== lastView;
  lastView = view;
  if (subjects) renderSubjects();
  else if (calendar) {
    if (moved) $('listCard').scrollTop = 0;
    renderCalendar();
    if (moved || first) refreshCalendar();
  }
  else if (!settings) renderList(first ? 'enter' : moved ? 'none' : 'flip');
  syncThumbs();
  // Changing views: the new page eases in
  if (moved && motion()) {
    const pane = subjects ? $('subjectsView') : settings ? $('settingsView') : calendar ? $('calendarView') : $('list');
    for (const n of [pane, $('title')]) n.animate(ENTER, { duration: 280, easing: EASE });
  }
}

function toggle(t, row) {
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  save();
  // Flip the class so CSS animates the tick, then fold the row out once it has drawn.
  // Ticking again before then cancels the move and the row just stays.
  row.classList.toggle('done', t.done);
  if (leaving.has(t.id)) { clearTimeout(leaving.get(t.id)); leaving.delete(t.id); return; }
  leaving.set(t.id, setTimeout(() => { leaving.delete(t.id); render(); }, motion() ? SETTLE : 0));
}

function openEdit(t) {
  editing = t;
  $('eTitle').value = t.title;
  fillSubjectSelect($('eSubject'), t.subject);
  $('eType').value = t.type;
  $('eDue').value = t.due;
  $('eNotes').value = t.notes || '';
  // Esc closes without setting returnValue, so clear it or the last Save/Delete would repeat
  $('editDialog').returnValue = '';
  $('editDialog').showModal();
}

function closeDialog(dlg, value) {
  if (!motion()) return dlg.close(value);
  dlg.classList.add('closing');
  dlg.addEventListener('animationend', function done(e) {
    if (e.target !== dlg) return;
    dlg.removeEventListener('animationend', done);
    dlg.classList.remove('closing');
    dlg.close(value);
  });
}
for (const [form, dlg] of [['editForm', 'editDialog'], ['slotForm', 'slotDialog']]) {
  $(form).addEventListener('submit', e => { e.preventDefault(); closeDialog($(dlg), e.submitter ? e.submitter.value : ''); });
  $(dlg).addEventListener('cancel', e => { e.preventDefault(); closeDialog($(dlg), 'cancel'); });
}

$('editDialog').addEventListener('close', () => {
  const action = $('editDialog').returnValue;
  if (action === 'save') {
    Object.assign(editing, {
      title: $('eTitle').value.trim() || editing.title,
      subject: $('eSubject').value,
      type: $('eType').value,
      due: $('eDue').value || editing.due,
      notes: $('eNotes').value.trim()
    });
  } else if (action === 'delete') {
    data.tasks = data.tasks.filter(t => t !== editing);
  }
  if (action === 'save' || action === 'delete') { save(); render(); }
  editing = null;
});

$('addForm').addEventListener('submit', e => {
  e.preventDefault();
  data.tasks.push({
    id: crypto.randomUUID(),
    title: $('fTitle').value.trim(),
    subject: $('fSubject').value,
    type: $('fType').value,
    due: $('fDue').value,
    notes: '',
    done: false,
    doneAt: null
  });
  $('fTitle').value = '';
  save(); render();
  $('fTitle').focus();
});

document.querySelectorAll('.nav').forEach(b => b.addEventListener('click', () => { view = b.dataset.view; render(); }));
document.querySelectorAll('#groupToggle button').forEach(b => b.addEventListener('click', () => {
  group = b.dataset.group;
  data.settings.group = group;
  save(); render();
}));

document.querySelectorAll('#themeToggle button').forEach(b => b.addEventListener('click', () => {
  data.settings.theme = b.dataset.theme;
  save();
  if (document.startViewTransition && motion()) document.startViewTransition(applyTheme);
  else applyTheme();
}));
function applyLogin() {
  const on = data.settings.openAtLogin !== false;
  document.querySelectorAll('#loginToggle button').forEach(b => b.classList.toggle('on', (b.dataset.login === 'on') === on));
  syncThumbs();
}
document.querySelectorAll('#loginToggle button').forEach(b => b.addEventListener('click', () => {
  data.settings.openAtLogin = b.dataset.login === 'on';
  window.store.setOpenAtLogin(data.settings.openAtLogin);
  save(); applyLogin();
}));
window.store.onFocusAdd(() => {
  if (view !== 'today' && view !== 'upcoming') { view = 'today'; render(); }
  $('fTitle').focus();
});
$('goSubjects').addEventListener('click', () => { view = 'subjects'; render(); });

// Tasks also live in the "Homework" Reminders list; a tick made on the iPhone arrives here
window.store.onRemoteTasks(changes => {
  for (const [id, done] of Object.entries(changes)) {
    const t = data.tasks.find(x => x.id === id);
    if (!t || t.done === done) continue;
    t.done = done;
    t.doneAt = done ? Date.now() : null;
    if (leaving.has(id)) { clearTimeout(leaving.get(id)); leaving.delete(id); }
  }
  save();
  if (view !== 'subjects' && view !== 'settings' && view !== 'calendar' && !editing) render();
});
function applySync(access) {
  $('syncState').textContent = {
    granted: 'On, in Reminders → Homework',
    denied: 'Off. Allow Homework in System Settings → Privacy & Security → Reminders.',
    undetermined: 'Starts once you open Calendar and allow Reminders'
  }[access] || 'Starting…';
}
window.store.onSyncStatus(applySync);
window.store.syncStatus().then(applySync);


// Calendar: the user's weekly timetable and one-off meetings (kept in tasks.json), plus Apple Calendar
// events and dated reminders read through the Swift helper. Weeks start on Monday.
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const minutes = hm => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const clock = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const dayIndex = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - weekStart) / DAY);

function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - (m.getDay() + 6) % 7);
  return m;
}

function weekLabel() {
  const fmt = d => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(weekStart)} – ${fmt(addDays(weekStart, 6))}`;
}

// A class takes its subject's colour when its title matches a subject
const slotColor = title => (data.subjects.find(s => s.name.toLowerCase() === title.toLowerCase()) || {}).color || COLORS[0];

function weekDays() {
  const days = [...Array(7)].map((_, i) => ({ date: addDays(weekStart, i), allDay: [], timed: [] }));
  const put = (i, item) => { if (i >= 0 && i < 7) days[i][item.allDay ? 'allDay' : 'timed'].push(item); };
  for (const t of data.timetable)
    put((t.day + 6) % 7, { kind: 'class', title: t.title, start: minutes(t.start), end: minutes(t.end), color: slotColor(t.title), src: t });
  for (const m of data.meetings)
    put(dayIndex(new Date(m.date + 'T00:00')), { kind: 'meeting', title: m.title, start: minutes(m.start), end: minutes(m.end), color: COLORS[3], src: m });
  if (cal.week !== localDate(weekStart)) return days;
  for (const e of cal.events) {
    const from = new Date(e.start), to = new Date(e.end);
    // Split anything that runs past midnight into one piece per day it touches
    for (let i = Math.max(0, dayIndex(from)); i < 7; i++) {
      const dayStart = addDays(weekStart, i), dayEnd = addDays(weekStart, i + 1);
      if (dayStart >= to) break;
      if (e.allDay) { put(i, { kind: 'event', allDay: true, title: e.title, color: e.color, note: e.calendar }); continue; }
      const s = Math.max(from, dayStart), f = Math.min(to, dayEnd);
      put(i, { kind: 'event', title: e.title, start: Math.round((s - dayStart) / 60000), end: Math.round((f - dayStart) / 60000), color: e.color, note: e.calendar });
    }
  }
  for (const r of cal.reminders) {
    const due = new Date(r.due), at = due.getHours() * 60 + due.getMinutes();
    put(dayIndex(due), r.hasTime
      ? { kind: 'reminder', title: r.title, start: at, end: Math.min(at + 30, 1440), color: r.color, note: r.list }
      : { kind: 'reminder', allDay: true, title: r.title, color: r.color, note: r.list });
  }
  return days;
}

// Side-by-side columns for items that overlap
function layOut(items) {
  items.sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster = [], laneEnds = [], clusterEnd = -1;
  const close = () => { for (const it of cluster) it.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const it of items) {
    if (it.start >= clusterEnd) close();
    let lane = laneEnds.findIndex(end => end <= it.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = it.end;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  close();
}

function calendarNotice() {
  if (cal.error) return el('p', { class: 'cal-note' }, `Couldn't read Apple Calendar right now (${cal.error}). Your own classes and meetings are still shown.`);
  const off = cal.access ? ['Calendar', 'Reminders'].filter(k => cal.access[k.toLowerCase()] !== 'granted') : [];
  if (!off.length) return null;
  return el('p', { class: 'cal-note' }, `Homework can't see your Apple ${off.join(' or ')}. To show ${off.length > 1 ? 'them' : 'it'} here, turn Homework on in System Settings → Privacy & Security → ${off.join(' and ')}.`);
}

function slotBlock(it, firstHour, day) {
  const own = it.kind === 'class' || it.kind === 'meeting';
  const span = `${clock(it.start)}–${clock(Math.min(it.end, 1440))}`;
  const height = Math.max((it.end - it.start) / 60 * HOUR, 20) - 2;
  return el('div', {
    class: `slot ${it.kind}` + (own ? ' own' : '') + (height < 34 ? ' short' : ''), // too short for two lines: time then title
    style: `top:${(it.start - firstHour * 60) / 60 * HOUR}px;height:${height}px;` +
      `left:calc(${it.lane / it.lanes * 100}% + 2px);width:calc(${100 / it.lanes}% - 4px);--c:${it.color || COLORS[0]}`,
    title: [it.title, it.kind === 'reminder' ? clock(it.start) : span, it.note].filter(Boolean).join('\n'),
    onclick: own ? () => openSlot(it.src, it.kind, day) : null
  }, el('span', { class: 't' }, it.title), el('span', { class: 'h' }, it.kind === 'reminder' ? `◦ ${clock(it.start)}` : span));
}

function renderCalendar() {
  const box = $('calendarView');
  const days = weekDays();
  const timed = days.flatMap(d => d.timed);
  const firstHour = Math.min(8, ...timed.map(it => Math.floor(it.start / 60)));
  const lastHour = Math.max(18, ...timed.map(it => Math.ceil(it.end / 60)));
  const todayKey = today();
  const now = new Date(), nowMins = now.getHours() * 60 + now.getMinutes();

  const head = el('div', { class: 'cal-row cal-head' }, el('span'), ...days.map(d =>
    el('div', { class: 'cal-day' + (localDate(d.date) === todayKey ? ' now' : '') },
      el('span', {}, d.date.toLocaleDateString(undefined, { weekday: 'short' })), el('b', {}, String(d.date.getDate())))));
  const strip = days.some(d => d.allDay.length) ? el('div', { class: 'cal-row cal-allday' }, el('span', { class: 'cal-hour' }, 'all day'),
    ...days.map(d => el('div', {}, ...d.allDay.map(it =>
      el('span', { class: `chip-slot ${it.kind}`, style: `--c:${it.color || COLORS[0]}`, title: [it.title, it.note].filter(Boolean).join('\n') }, it.title))))) : null;

  const hours = el('div', { class: 'cal-hours' }, ...[...Array(lastHour - firstHour)].map((_, i) =>
    el('span', { style: `top:${i * HOUR}px` }, clock((firstHour + i) * 60))));
  const cols = days.map(d => {
    layOut(d.timed);
    const col = el('div', { class: 'cal-col' }, ...d.timed.map(it => slotBlock(it, firstHour, d.date)));
    if (localDate(d.date) === todayKey && nowMins >= firstHour * 60 && nowMins <= lastHour * 60)
      col.append(el('span', { class: 'now-line', style: `top:${(nowMins - firstHour * 60) / 60 * HOUR}px` }));
    return col;
  });
  const grid = el('div', { class: 'cal-row cal-grid', style: `height:${(lastHour - firstHour) * HOUR}px;--hour:${HOUR}px` }, hours, ...cols);

  const scroll = $('listCard').scrollTop;
  box.replaceChildren(...[calendarNotice(), head, strip, grid].filter(Boolean));
  $('listCard').scrollTop = scroll;
  if (!data.timetable.length && !data.meetings.length && !timed.length && !strip)
    box.append(el('p', { class: 'hint' }, 'Add your classes below. Pick "Every week" for your timetable or "Just once" for a meeting.'));
}

// Asks the helper for the shown week; the first time, macOS asks for Calendar and Reminders access
async function refreshCalendar() {
  const week = localDate(weekStart);
  const res = await window.store.fetchCalendar(weekStart.toISOString(), addDays(weekStart, 7).toISOString());
  if (week !== localDate(weekStart)) return; // moved to another week while waiting
  cal = { week, access: res.access || null, events: res.events || [], reminders: res.reminders || [], error: res.error || null };
  if (view === 'calendar' && !slotEditing) renderCalendar();
}

function moveWeek(n) {
  weekStart = n ? addDays(weekStart, 7 * n) : mondayOf(new Date());
  render();
  if (motion()) $('calendarView').animate([{ opacity: 0, transform: `translateX(${(n || 0) * 14}px)` }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE });
  refreshCalendar();
}
$('wPrev').addEventListener('click', () => moveWeek(-1));
$('wNext').addEventListener('click', () => moveWeek(1));
$('wToday').addEventListener('click', () => moveWeek(0));

// Calendar or Reminders changed (they fire in bursts), the window came back, or five minutes passed
let calTimer = null;
const calSoon = () => { clearTimeout(calTimer); calTimer = setTimeout(() => { if (view === 'calendar') refreshCalendar(); }, 400); };
window.store.onCalendarChanged(calSoon);
window.addEventListener('focus', calSoon);
setInterval(calSoon, 5 * 60 * 1000);

// Same fields for adding and editing; returns null (and says why) if the times don't make sense
function readSlot(p) {
  const end = $(p + 'End');
  end.setCustomValidity(minutes(end.value) > minutes($(p + 'Start').value) ? '' : 'Ends before it starts');
  if (!end.reportValidity()) return null;
  const date = $(p + 'Date').value;
  const base = { title: $(p + 'Title').value.trim(), start: $(p + 'Start').value, end: end.value };
  return $(p + 'Kind').value === 'weekly' ? { ...base, day: new Date(date + 'T00:00').getDay() } : { ...base, date };
}

function storeSlot(slot, kind) {
  (kind === 'weekly' ? data.timetable : data.meetings).push({ id: crypto.randomUUID(), ...slot });
}

$('calForm').addEventListener('submit', e => {
  e.preventDefault();
  const slot = readSlot('c');
  if (!slot || !slot.title) return;
  storeSlot(slot, $('cKind').value);
  $('cTitle').value = '';
  save(); render();
  $('cTitle').focus();
});
$('cEnd').addEventListener('input', e => e.target.setCustomValidity(''));
$('sEnd').addEventListener('input', e => e.target.setCustomValidity(''));

function openSlot(src, kind, day) {
  slotEditing = { src, kind };
  $('sTitle').value = src.title;
  $('sKind').value = kind === 'class' ? 'weekly' : 'meeting';
  $('sDate').value = kind === 'class' ? localDate(day) : src.date;
  $('sStart').value = src.start;
  $('sEnd').value = src.end;
  $('slotDialog').returnValue = '';
  $('slotDialog').showModal();
}

// Saving goes through the form's validation first, so a bad end time keeps the dialog open
$('slotForm').addEventListener('submit', e => {
  if (e.submitter && e.submitter.value === 'save' && !readSlot('s')) { e.preventDefault(); e.stopImmediatePropagation(); }
}, true);

$('slotDialog').addEventListener('close', () => {
  const action = $('slotDialog').returnValue;
  const { src, kind } = slotEditing;
  if (action === 'save' || action === 'delete') {
    if (kind === 'class') data.timetable = data.timetable.filter(t => t !== src);
    else data.meetings = data.meetings.filter(m => m !== src);
    if (action === 'save') storeSlot(readSlot('s'), $('sKind').value);
    save();
  }
  slotEditing = null;
  if (view === 'calendar') renderCalendar();
});

(async () => {
  data = Object.assign(data, await window.store.load());
  group = data.settings.group || 'date';
  applyTheme();
  applyLogin();
  $('fDue').value = today();
  $('cDate').value = today();
  weekStart = mondayOf(new Date());
  render();
  setInterval(() => { if (view !== 'subjects' && view !== 'settings' && !editing && !slotEditing) render(); }, 60 * 1000); // roll groups over at midnight
})();
