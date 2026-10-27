const { app, BrowserWindow, ipcMain, Notification, nativeTheme, Tray, Menu, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = () => path.join(app.getPath('userData'), 'tasks.json');
// Kept apart from tasks.json so the window's saves never overwrite it
const remindedFile = () => path.join(app.getPath('userData'), 'reminded.json');
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

ipcMain.handle('data:load', () => load());
ipcMain.handle('data:save', (_e, data) => save(data));

ipcMain.handle('theme:set', (_e, mode) => { nativeTheme.themeSource = mode; });
ipcMain.handle('login:set', (_e, on) => setOpenAtLogin(on));

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
  app.on('activate', () => showWindow());
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
