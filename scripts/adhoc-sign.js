// There's no Developer ID, so seal the app with an ad-hoc signature. Without it macOS sees a bare
// "Electron" binary and can't keep the Calendar and Reminders permissions attached to Homework.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async ({ appOutDir, packager }) => {
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
