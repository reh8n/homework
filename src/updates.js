// Looks for a newer release on GitHub and offers it. The app is ad-hoc signed, and macOS only installs
// updates by itself for apps with a paid Developer ID, so this points to the download instead.
const { app, net, Notification, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const REPO = 'reh8n/homework';
const EVERY = 6 * 60 * 60 * 1000; // six hours
const seenFile = () => path.join(app.getPath('userData'), 'update-notified.json');

// "1.10.0" > "1.9.2"; a leading "v" is ignored
function isNewer(latest, current) {
  const parts = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function latestRelease() {
  const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Homework/${app.getVersion()}` }
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  return { version: r.tag_name.replace(/^v/, ''), url: r.html_url };
}

// onFound(update) runs whenever a newer version is known, so the caller can show it (e.g. in the tray)
function startUpdateChecks(onFound) {
  // The App Store does its own updates, and a dev run has no release to compare with
  if (process.mas || !app.isPackaged) return;

  const check = async () => {
    let latest;
    try { latest = await latestRelease(); } catch { return; } // offline or rate-limited: try again later
    if (!isNewer(latest.version, app.getVersion())) return;
    onFound(latest);
    // Notify once per version, not on every launch
    let seen = null;
    try { seen = JSON.parse(fs.readFileSync(seenFile(), 'utf8')).version; } catch {}
    if (seen === latest.version) return;
    const n = new Notification({ title: `Homework ${latest.version} is available`, body: 'Click to download the update.' });
    n.on('click', () => shell.openExternal(latest.url));
    n.show();
    fs.writeFileSync(seenFile(), JSON.stringify({ version: latest.version }));
  };

  setTimeout(check, 10 * 1000); // let startup finish first
  setInterval(check, EVERY);
}

module.exports = { startUpdateChecks, isNewer };
