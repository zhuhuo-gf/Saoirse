'use strict';
/**
 * afterPack hook: embed the Saoirse icon + version metadata into the Windows
 * executable ourselves, because electron-builder's built-in rcedit step needs
 * the winCodeSign archive whose macOS dylib symlinks fail to extract on a
 * Windows box without Developer Mode. The standalone rcedit binary is bundled
 * in build/ and does the same job without touching those macOS files.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }
  const rcedit = path.join(__dirname, 'build', 'rcedit-x64.exe');
  const icon = path.join(__dirname, 'build', 'icon.ico');
  if (!fs.existsSync(rcedit) || !fs.existsSync(icon)) {
    console.log('[afterPack] rcedit or icon missing, skipping exe edit');
    return;
  }
  const exe = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.exe');
  const version = `${context.packager.appInfo.version}.0`;
  execFileSync(
    rcedit,
    [
      exe,
      '--set-icon', icon,
      '--set-version-string', 'ProductName', 'Saoirse',
      '--set-version-string', 'FileDescription', 'Saoirse Desktop Companion',
      '--set-version-string', 'CompanyName', 'Saoirse Project Contributors',
      '--set-file-version', version,
      '--set-product-version', version,
    ],
    { stdio: 'inherit' },
  );
  console.log('[afterPack] applied icon + version to', exe);
};
