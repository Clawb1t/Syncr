'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const { execSync, exec } = require('child_process');
const os     = require('os');

// ─── Paths (per-user, no admin) ───────────────────────────────────────────────

const INSTALL_DIR        = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Syncr');
const HOST_EXE           = path.join(INSTALL_DIR, 'syncr-host.exe');
const MANIFEST_PATH      = path.join(INSTALL_DIR, 'syncr.json');
const XPI_PATH           = path.join(INSTALL_DIR, 'syncr.xpi');
const VERSION_PATH       = path.join(INSTALL_DIR, 'version.json');
const INSTALL_STATE_PATH = path.join(INSTALL_DIR, 'install.json');
const ACTS_DIR           = path.join(INSTALL_DIR, 'activities');

const GITHUB_API  = 'https://api.github.com/repos/Clawb1t/Syncr/releases/latest';
const GITHUB_RAW  = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const FALLBACK_ACTIVITIES = ['youtube', 'youtube-music'];

let win;

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 520,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#0f0f17',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function semverGt(a, b) {
  if (!a || !b) return false;
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

function fileSha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Syncr-Setup/1.0' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        return resolve(fetchBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    function doRequest(reqUrl) {
      const mod = reqUrl.startsWith('https') ? https : http;
      mod.get(reqUrl, { headers: { 'User-Agent': 'Syncr-Setup/1.0' } }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode)) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

        const total = parseInt(res.headers['content-length'] || '0', 10);
        let done = 0;
        const tmp = dest + '.tmp';
        const file = fs.createWriteStream(tmp);

        res.on('data', chunk => {
          done += chunk.length;
          if (onProgress && total) onProgress(done / total);
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try { fs.renameSync(tmp, dest); } catch (e) { reject(e); return; }
            resolve();
          });
        });
        file.on('error', err => { try { fs.unlinkSync(tmp); } catch {} reject(err); });
        res.on('error', reject);
      }).on('error', reject);
    }
    doRequest(url);
  });
}

function stopSyncrHost() {
  return new Promise(resolve => {
    exec('taskkill /F /IM syncr-host.exe', () => resolve());
    setTimeout(resolve, 800);
  });
}

async function replaceFileAtomically(tmpPath, destPath, { stopHost = false } = {}) {
  if (stopHost) await stopSyncrHost();
  for (let i = 0; i < 5; i++) {
    try {
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      fs.renameSync(tmpPath, destPath);
      return;
    } catch {
      if (stopHost) await stopSyncrHost();
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error(`Could not replace ${path.basename(destPath)} — close Firefox and try again.`);
}

function writeManifest() {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    name: 'syncr',
    description: 'Syncr Native Messaging Host',
    path: HOST_EXE,
    type: 'stdio',
    allowed_extensions: ['syncr@clawb1t'],
  }, null, 2), 'utf8');
}

function writeRegistry() {
  const q = `"${MANIFEST_PATH}"`;
  execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d ${q} /f`);
}

function readLocalHostVersion() {
  if (fs.existsSync(VERSION_PATH)) {
    try { return JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')).version ?? null; } catch {}
  }
  return null;
}

function writeInstallState(state) {
  fs.writeFileSync(INSTALL_STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

const { isXpiSigned, readXpiVersion } = require('./xpi-utils');

function assertValidXpi(xpiPath, releaseTag) {
  if (!fs.existsSync(xpiPath)) {
    throw new Error('syncr.xpi is missing after download.');
  }
  if (!isXpiSigned(xpiPath)) {
    throw new Error(
      'syncr.xpi is not signed by Mozilla. ' +
      'The GitHub release may have been published before AMO review finished - wait a few minutes and run Setup again.'
    );
  }
  const version = readXpiVersion(xpiPath) || releaseTag;
  if (releaseTag && version && version !== releaseTag) {
    throw new Error(
      `Downloaded extension is v${version} but the release is v${releaseTag}. ` +
      'The GitHub release asset may still be updating - try again in a few minutes.'
    );
  }
  return version || releaseTag;
}

// ─── GitHub release info ──────────────────────────────────────────────────────

async function fetchReleaseInfo() {
  const raw = await fetchBuffer(GITHUB_API);
  const release = JSON.parse(raw.toString());
  const releaseTag = release.tag_name?.replace(/^v/, '') ?? null;
  const assets = {};
  for (const a of (release.assets || [])) {
    if (a.name === 'syncr-host.exe') assets.host = a.browser_download_url;
    if (a.name === 'syncr.xpi') assets.xpi = a.browser_download_url;
    if (/^Syncr-Setup/i.test(a.name) && a.name.endsWith('.exe')) assets.setup = a.browser_download_url;
  }

  let latestHostVersion = null;
  try {
    const v = JSON.parse((await fetchBuffer(`${GITHUB_RAW}/native-host/version.json`)).toString());
    latestHostVersion = v.version ?? null;
  } catch {}

  return { releaseTag, latestHostVersion, assets };
}

async function fetchActivityIds() {
  try {
    const reg = JSON.parse(
      (await fetchBuffer(`${GITHUB_RAW}/extension/activities/registry.json`)).toString()
    );
    return reg.activities ?? FALLBACK_ACTIVITIES;
  } catch {
    return FALLBACK_ACTIVITIES;
  }
}

// ─── Component sync (every Setup run) ─────────────────────────────────────────
//
// Never trust cached files in %LOCALAPPDATA%\Syncr. Each run re-syncs from GitHub:
//   • Extension XPI — always re-downloaded from the release asset, signature-checked
//   • Activities    — always re-downloaded from main
//   • Native host   — re-downloaded when missing or version is behind
//   • Registry      — always rewritten so paths stay correct

async function syncHost(assets, latestHostVersion) {
  const localVersion = readLocalHostVersion();
  const hostMissing  = !fs.existsSync(HOST_EXE);
  const hostStale    = latestHostVersion && semverGt(latestHostVersion, localVersion);

  if (!hostMissing && !hostStale) {
    send('step', `Native host v${localVersion || latestHostVersion} is up to date`);
    return false;
  }

  if (!assets?.host) throw new Error('syncr-host.exe not found on GitHub release.');

  send('step', hostMissing ? 'Downloading native host…' : `Updating native host v${localVersion} → v${latestHostVersion}…`);
  const hostTmp = HOST_EXE + '.new';
  await downloadFile(assets.host, hostTmp, p => send('progress', p * 0.35));
  send('step', 'Installing native host…');
  await replaceFileAtomically(hostTmp, HOST_EXE, { stopHost: true });

  try {
    const vBuf = await fetchBuffer(`${GITHUB_RAW}/native-host/version.json`);
    fs.writeFileSync(VERSION_PATH, vBuf);
  } catch {}

  return true;
}

async function syncActivities() {
  const ids = await fetchActivityIds();
  fs.mkdirSync(ACTS_DIR, { recursive: true });

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    send('step', `Downloading ${id} activity…`);
    const buf = await fetchBuffer(`${GITHUB_RAW}/native-host/activities/${id}/presence.js`);
    const dest = path.join(ACTS_DIR, id, 'presence.js');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.tmp', buf);
    fs.renameSync(dest + '.tmp', dest);
    send('progress', 0.35 + (i + 1) / ids.length * 0.25);
  }
}

async function syncExtensionXpi(assets, releaseTag) {
  if (!assets?.xpi) throw new Error('syncr.xpi not found on GitHub release.');

  // Always fetch a fresh copy from the GitHub release — never reuse a cached XPI.
  send('step', `Downloading Firefox extension v${releaseTag || ''}…`.trim());
  const xpiTmp = XPI_PATH + '.new';
  await downloadFile(assets.xpi, xpiTmp, p => send('progress', 0.65 + p * 0.3));

  const version = assertValidXpi(xpiTmp, releaseTag);
  await replaceFileAtomically(xpiTmp, XPI_PATH);
  send('step', `Extension v${version || releaseTag} verified (Mozilla signed)`);
  return version;
}

async function syncInstall(info) {
  const { releaseTag, latestHostVersion, assets } = info;

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  send('phase', 'installing');

  const hostUpdated = await syncHost(assets, latestHostVersion);
  await syncActivities();
  const extensionVersion = await syncExtensionXpi(assets, releaseTag);

  send('step', 'Registering with Firefox…');
  writeManifest();
  writeRegistry();

  writeInstallState({
    releaseTag,
    hostVersion: latestHostVersion,
    extensionVersion,
    xpiSha256: fileSha256(XPI_PATH),
    syncedAt: new Date().toISOString(),
  });

  send('progress', 1);
  return { hostUpdated, extensionVersion };
}

async function openXpi(releaseTag) {
  assertValidXpi(XPI_PATH, releaseTag);
  send('step', 'Opening Firefox…');
  send('phase', 'firefox');
  await shell.openPath(XPI_PATH);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('window:close', () => app.quit());
ipcMain.handle('window:minimize', () => win.minimize());

ipcMain.handle('syncr:autoSetup', async () => {
  try {
    send('phase', 'checking');
    send('step', 'Checking GitHub for latest release…');

    let info;
    try {
      info = await fetchReleaseInfo();
    } catch (e) {
      return { ok: false, error: `Could not reach GitHub: ${e.message}` };
    }

    const result = await syncInstall(info);
    await openXpi(info.releaseTag);

    send('phase', 'done');
    return { ok: true, ...result };
  } catch (e) {
    send('phase', 'error');
    return { ok: false, error: e.message };
  }
});
