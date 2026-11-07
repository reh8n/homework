// There's no Developer ID, so seal the app with an ad-hoc signature. Without it macOS sees a bare
// "Electron" binary and can't keep the Calendar and Reminders permissions attached to Homework.
// Mac App Store builds are signed properly by electron-builder, so they're left alone.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async ({ appOutDir, packager, electronPlatformName }) => {
  if (electronPlatformName === 'mas') return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
