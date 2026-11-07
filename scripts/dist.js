// Builds the DMG on the Mac's own disk, then copies it into dist/. Building straight onto an exFAT
// drive fails: macOS adds hidden "._" files next to app.asar and electron-builder trips over them.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const { version, productName } = require(path.join(root, 'package.json'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'homework-dist-'));

try {
  execFileSync('npx', ['electron-builder', '--mac', 'dmg', '--arm64', `-c.directories.output=${out}`], {
    cwd: root, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const name of [`${productName}-${version}-arm64.dmg`, `${productName}-${version}-arm64.dmg.blockmap`]) {
    fs.copyFileSync(path.join(out, name), path.join(root, 'dist', name));
  }
  console.log(`Built dist/${productName}-${version}-arm64.dmg`);
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
