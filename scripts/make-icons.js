// Renders the app icon and menu-bar icons. Run: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const draw = `(() => {
  const out = {};
  const squircle = (c, x, y, s, r) => { c.beginPath(); c.roundRect(x, y, s, s, r); };

  // App icon: raised soft square, pressed-in well, checkmark
  const a = document.createElement('canvas'); a.width = a.height = 1024;
  const c = a.getContext('2d');
  const x = 100, s = 824, r = 185;
  c.fillStyle = '#E4E8EE';
  c.shadowColor = 'rgba(150,160,178,.55)'; c.shadowBlur = 50; c.shadowOffsetX = 18; c.shadowOffsetY = 22;
  squircle(c, x, x, s, r); c.fill();
  c.shadowColor = 'transparent';
  const g = c.createLinearGradient(x, x, x + s, x + s);
  g.addColorStop(0, '#EEF1F5'); g.addColorStop(1, '#DCE1E8');
  c.fillStyle = g; squircle(c, x, x, s, r); c.fill();
  // pressed-in well
  const w = 470, wx = 512 - w / 2, wr = 120;
  c.save(); squircle(c, wx, wx, w, wr); c.clip();
  c.fillStyle = '#E1E5EB'; c.fillRect(wx, wx, w, w);
  c.lineWidth = 40;
  c.shadowBlur = 34; c.shadowColor = 'rgba(160,170,188,.9)'; c.shadowOffsetX = 14; c.shadowOffsetY = 14;
  c.strokeStyle = '#E1E5EB'; squircle(c, wx - 20, wx - 20, w + 40, wr + 20); c.stroke();
  c.shadowColor = 'rgba(255,255,255,.95)'; c.shadowOffsetX = -14; c.shadowOffsetY = -14;
  squircle(c, wx - 20, wx - 20, w + 40, wr + 20); c.stroke();
  c.restore();
  // checkmark
  c.lineCap = c.lineJoin = 'round'; c.lineWidth = 58;
  c.strokeStyle = '#7C8BA6';
  c.beginPath(); c.moveTo(405, 520); c.lineTo(480, 595); c.lineTo(625, 440); c.stroke();
  out.icon = a.toDataURL('image/png');

  // Menu-bar template: black on transparent, macOS tints it
  for (const [name, n] of [['tray', 16], ['tray2x', 32]]) {
    const t = document.createElement('canvas'); t.width = t.height = n;
    const k = t.getContext('2d'), u = n / 16;
    k.strokeStyle = '#000'; k.lineWidth = 1.4 * u; k.lineCap = k.lineJoin = 'round';
    k.beginPath(); k.roundRect(2 * u, 2 * u, 12 * u, 12 * u, 3.5 * u); k.stroke();
    k.lineWidth = 1.6 * u;
    k.beginPath(); k.moveTo(5.2 * u, 8.2 * u); k.lineTo(7.2 * u, 10.2 * u); k.lineTo(10.9 * u, 6 * u); k.stroke();
    out[name] = t.toDataURL('image/png');
  }
  return out;
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const out = await win.webContents.executeJavaScript(draw);
  const root = path.join(__dirname, '..');
  const write = (file, url) => fs.writeFileSync(path.join(root, file), Buffer.from(url.split(',')[1], 'base64'));
  write('build/icon.png', out.icon);
  write('src/trayTemplate.png', out.tray);
  write('src/trayTemplate@2x.png', out.tray2x);
  app.quit();
});
