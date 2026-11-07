// Publishes the version in package.json as a GitHub release with its DMG.
// Copies of Homework already installed find it within six hours and offer the download.
// Usage: raise "version" in package.json, commit and push, then `npm run release`.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const { version, productName } = require(path.join(root, 'package.json'));
const tag = `v${version}`;
const dmg = path.join(root, 'dist', `${productName}-${version}-arm64.dmg`);

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts });
const fail = msg => { console.error(`\nCan't release ${tag}: ${msg}`); process.exit(1); };

// The release has to match code that's on GitHub
if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim()) fail('commit your changes first.');
run('git', ['fetch', '--quiet', 'origin', 'main']);
const head = run('git', ['rev-parse', 'HEAD']).trim();
if (head !== run('git', ['rev-parse', 'origin/main']).trim()) fail('push main to GitHub first (git push).');

let existing = true;
try { run('gh', ['release', 'view', tag], { stdio: 'ignore' }); } catch { existing = false; }
if (existing) fail(`${tag} is already released. Raise "version" in package.json.`);

console.log(`Building ${productName} ${version}…`);
run('npm', ['run', 'dist'], { stdio: 'inherit' });
if (!fs.existsSync(dmg)) fail(`the build didn't produce ${path.relative(root, dmg)}.`);

console.log(`Publishing ${tag}…`);
run('gh', [
  'release', 'create', tag, dmg,
  '--target', head,
  '--title', `${productName} ${version}`,
  '--generate-notes',
  '--notes', `${productName} ${version} for Apple Silicon Macs (arm64).\n\nAd-hoc signed: on first launch, right-click the app and choose Open.`
], { stdio: 'inherit' });
