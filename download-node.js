'use strict';

// Prepare a project-local Node runtime for Windows packaging.
// No machine-wide Node installation is modified.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERSION = process.env.SAOIRSE_NODE_VERSION || '24.16.0';
const cacheDir = path.join(__dirname, '.electron-cache');
const zipPath = path.join(cacheDir, `node-v${VERSION}-win-x64.zip`);
const extractDir = path.join(cacheDir, `node-v${VERSION}-win-x64`);
const runtimeDir = path.join(__dirname, 'node-runtime');
const runtimeExe = path.join(runtimeDir, 'node.exe');
const mirrors = [
  `https://nodejs.org/dist/v${VERSION}/node-v${VERSION}-win-x64.zip`,
  `https://cdn.npmmirror.com/binaries/node/v${VERSION}/node-v${VERSION}-win-x64.zip`,
];

fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(runtimeDir, { recursive: true });

function download(url, destination, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destination}.part`;
    const out = fs.createWriteStream(tempPath);
    const req = https.get(url, { headers: { 'User-Agent': 'Saoirse-Node-Runtime' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume();
        out.destroy();
        try { fs.unlinkSync(tempPath); } catch { /* absent */ }
        const next = new URL(res.headers.location, url).toString();
        download(next, destination, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        out.destroy();
        reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        return;
      }
      res.pipe(out);
      out.once('finish', () => {
        out.close(() => {
          fs.renameSync(tempPath, destination);
          resolve();
        });
      });
    });
    req.setTimeout(30000, () => req.destroy(new Error('download timed out')));
    req.once('error', (error) => {
      out.destroy();
      try { fs.unlinkSync(tempPath); } catch { /* absent */ }
      reject(error);
    });
    out.once('error', reject);
  });
}

function findNodeExe(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === 'node.exe') return full;
    if (entry.isDirectory()) {
      const found = findNodeExe(full);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  if (!fs.existsSync(zipPath)) {
    let lastError;
    for (const url of mirrors) {
      try {
        console.log(`[runtime] downloading Node ${VERSION} from ${new URL(url).host}`);
        await download(url, zipPath);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        console.warn(`[runtime] ${error.message}`);
      }
    }
    if (lastError) throw lastError;
  }

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const result = spawnSync('tar', ['-xf', zipPath, '-C', extractDir], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Unable to extract Node archive with tar');

  const sourceExe = findNodeExe(extractDir);
  if (!sourceExe) throw new Error('node.exe was not found in the downloaded archive');
  fs.copyFileSync(sourceExe, runtimeExe);

  const versionCheck = spawnSync(runtimeExe, ['--version'], { encoding: 'utf8' });
  if (versionCheck.status !== 0) throw new Error('Bundled Node runtime did not start');
  console.log(`[runtime] ready: ${runtimeExe} (${versionCheck.stdout.trim()})`);
}

main().catch((error) => {
  console.error('[runtime] failed:', error.message);
  process.exitCode = 1;
});
