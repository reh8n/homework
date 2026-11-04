const { app, BrowserWindow, ipcMain, Notification, nativeTheme, Tray, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');
// Kept apart from tasks.json so the window's saves never overwrite it
const remindedFile = () => path.join(app.getPath('userData'), 'reminded.json');
// Which reminder belongs to which task, and whether it was last synced ticked; apart from tasks.json for the same reason
const syncFile = () => path.join(app.getPath('userData'), 'reminders-sync.json');
const REMIND_HOUR = 19; // evening before, 7pm
const MORNING_HOUR = 7; // missed reminders wait for morning, not 00:05 or a 3am wake

const localDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function load() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
  catch (e) {
    // Keep an unreadable file aside so the next save can't wipe it for good
    if (e.code !== 'ENOENT') fs.renameSync(dataFile(), dataFile().replace(/\.json$/, `.broken-${Date.now()}.json`));
    return { tasks: [], subjects: [], settings: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2));
}

let win = null;
let tray = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 520,
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#2B2E33' : '#E4E8EE',
    show: false, // appear once painted, no blank frame
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
}

function showWindow(then) {
  if (!win) {
    createWindow();
    if (then) win.webContents.once('did-finish-load', () => win.webContents.send(then));
  } else {
    if (win.isMinimized()) win.restore();
    win.show();
    if (then) win.webContents.send(then);
  }
  app.focus({ steal: true });
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'trayTemplate.png'));
  tray.setToolTip('Homework');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Homework', click: () => showWindow() },
    { label: 'Add task…', click: () => showWindow('focus-add') },
    { type: 'separator' },
    { label: 'Quit Homework', click: () => app.quit() }
  ]));
}

function setOpenAtLogin(on) {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on });
}

// Notify once per task: the evening before it's due, or on the day if that was missed (Mac asleep at 7pm)
function checkReminders() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const todayKey = localDate(now);
  const tomorrowKey = localDate(tomorrow);
  let reminded = [];
  try { reminded = JSON.parse(fs.readFileSync(remindedFile(), 'utf8')); } catch {}
  // Keyed by id and due date, so moving a task's due date reminds again
  const due = load().tasks.filter(t => !t.done && !reminded.includes(`${t.id}@${t.due}`) &&
    ((t.due === todayKey && now.getHours() >= MORNING_HOUR) || (t.due === tomorrowKey && now.getHours() >= REMIND_HOUR)));
  for (const t of due) {
    const when = t.due === todayKey ? 'today' : 'tomorrow';
    new Notification({ title: `Due ${when}: ${t.title}`, body: [t.subject, t.type].filter(Boolean).join(' · ') }).show();
    reminded.push(`${t.id}@${t.due}`);
  }
  if (due.length) fs.writeFileSync(remindedFile(), JSON.stringify(reminded));
}

// Swift helper that reads Apple Calendar and Reminders; started the first time the Calendar tab asks,
// so the macOS permission prompts appear then and not at login
const helperPath = () => app.isPackaged ? path.join(process.resourcesPath, 'calhelper') : path.join(__dirname, '..', 'native', 'bin', 'calhelper');
let helper = null;
let nextId = 1;
const pending = new Map(); // request id -> resolve

function startHelper() {
  const h = helper = spawn(helperPath(), [], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  h.stdout.on('data', chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.changed) { if (win) win.webContents.send('calendar-changed'); syncSoon(); continue; }
      const resolve = pending.get(msg.id);
      pending.delete(msg.id);
      if (resolve) resolve(msg);
    }
  });
  // Crashed or missing: answer anything waiting, and start afresh on the next fetch
  const gone = () => {
    if (helper !== h) return;
    helper = null;
    for (const resolve of pending.values()) resolve({ error: 'Calendar helper stopped' });
    pending.clear();
  };
  h.on('exit', gone);
  h.on('error', gone);
  h.stdin.on('error', () => {});
}

function ask(req) {
  if (!helper) startHelper();
  const id = nextId++;
  return new Promise(resolve => {
    pending.set(id, resolve);
    helper.stdin.write(JSON.stringify({ id, ...req }) + '\n');
  });
}

function readSync() {
  try { return JSON.parse(fs.readFileSync(syncFile(), 'utf8')); } catch { return { listId: null, tasks: {} }; }
}

async function fetchCalendar(start, end) {
  const res = await ask({ start, end, skipList: readSync().listId });
  // Reminders access may have just been granted at the prompt
  if (res.access && res.access.reminders === 'granted' && syncAccess !== 'granted') syncSoon();
  return res;
}

// Mirror tasks into the "Homework" Reminders list so iCloud puts them on the iPhone. Ticks made there
// come back as task.done. Runs after every save, when Reminders change, and every five minutes.
let syncAccess = null;
let syncing = null, syncAgain = false, syncTimer = null;
const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncReminders, 800); };

async function syncReminders() {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    const state = readSync();
    const { tasks } = load();
    const ids = new Set(tasks.map(t => t.id));
    const res = await ask({
      op: 'sync', listId: state.listId,
      tasks: tasks.map(t => ({
        id: t.id, title: t.subject ? `${t.subject}: ${t.title}` : t.title, notes: t.notes || '', due: t.due, done: !!t.done,
        rid: state.tasks[t.id]?.rid, synced: state.tasks[t.id]?.done
      })),
      remove: Object.entries(state.tasks).filter(([id]) => !ids.has(id)).map(([, s]) => s.rid)
    });
    syncAccess = res.access || null;
    if (win) win.webContents.send('sync-status', syncAccess);
    if (!res.synced) return;
    fs.writeFileSync(syncFile(), JSON.stringify({ listId: res.listId, tasks: res.synced }));
    const remote = Object.entries(res.remote || {});
    if (!remote.length) return;
    // Ticked or unticked in Reminders: change the file now in case the window is closed, and tell the window
    const data = load();
    for (const [id, done] of remote) {
      const t = data.tasks.find(x => x.id === id);
      if (t) { t.done = done; t.doneAt = done ? Date.now() : null; }
    }
    save(data);
    if (win) win.webContents.send('tasks-remote', res.remote);
  })().catch(() => {}).finally(() => {
    syncing = null;
    if (syncAgain) { syncAgain = false; syncSoon(); }
  });
  return syncing;
}

ipcMain.handle('data:load', () => load());
ipcMain.handle('data:save', (_e, data) => { save(data); syncSoon(); });

ipcMain.handle('theme:set', (_e, mode) => { nativeTheme.themeSource = mode; });
ipcMain.handle('login:set', (_e, on) => setOpenAtLogin(on));
ipcMain.handle('calendar:fetch', (_e, start, end) => fetchCalendar(start, end));
ipcMain.handle('sync:status', () => syncAccess);

// One copy only, so login launch + opening from Applications don't double up reminders
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  const { settings = {} } = load();
  nativeTheme.themeSource = settings.theme || 'system';
  setOpenAtLogin(settings.openAtLogin !== false);
  createTray();
  // Started by login: stay in the menu bar, no window
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createWindow();
  checkReminders();
  setInterval(checkReminders, 5 * 60 * 1000);
  // A Mac asleep at 7pm misses the timer, so check again on wake
  powerMonitor.on('resume', checkReminders);
  powerMonitor.on('unlock-screen', checkReminders);
  // Only syncs if Reminders access was already given; the prompt itself waits for the Calendar tab
  syncReminders();
  setInterval(syncReminders, 5 * 60 * 1000);
  app.on('activate', () => showWindow());
});

app.on('will-quit', () => { if (helper) helper.kill(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
