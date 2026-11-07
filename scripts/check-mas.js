// Stops a Mac App Store build early if the Apple account details haven't been filled in yet.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const problems = [];

const teamId = pkg.build.mas.extendInfo.ElectronTeamID;
if (!/^[A-Z0-9]{10}$/.test(teamId)) problems.push('Set build.mas.extendInfo.ElectronTeamID in package.json to your 10-character Team ID.');

const entitlements = fs.readFileSync(path.join(root, pkg.build.mas.entitlements), 'utf8');
if (entitlements.includes('TEAMID.')) problems.push(`Replace TEAMID in ${pkg.build.mas.entitlements} with your Team ID.`);
else if (!entitlements.includes(`${teamId}.`)) problems.push(`The app group in ${pkg.build.mas.entitlements} doesn't start with ElectronTeamID (${teamId}).`);

if (!fs.existsSync(path.join(root, pkg.build.mas.provisioningProfile))) {
  problems.push(`Download your Mac App Store provisioning profile and save it as ${pkg.build.mas.provisioningProfile}.`);
}

if (problems.length) {
  console.error('Not ready to build for the Mac App Store:\n' + problems.map(p => `  - ${p}`).join('\n') + '\nSee APP_STORE.md.');
  process.exit(1);
}
