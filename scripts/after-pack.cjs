const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function removeUnusedMacPermissions(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const unusedKeys = [
    'NSAppTransportSecurity',
    'NSAudioCaptureUsageDescription',
    'NSBluetoothAlwaysUsageDescription',
    'NSBluetoothPeripheralUsageDescription',
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
  ];
  for (const key of unusedKeys) {
    try {
      execFileSync('/usr/bin/plutil', ['-remove', key, plistPath], { stdio: 'ignore' });
    } catch {
      // Missing keys already satisfy the packaging contract.
    }
  }

  // Updating Info.plist invalidates Electron's embedded ad-hoc signature.
  // Re-sign the final bundle so local beta downloads pass macOS validation.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
