'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const https  = require('https');
const http   = require('http');
const { execSync, exec, spawn } = require('child_process');
const os     = require('os');

// ─── Platform ─────────────────────────────────────────────────────────────────

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// ─── Paths (per-user, no admin) ───────────────────────────────────────────────

function resolveInstallDir() {
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Syncr');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Syncr');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Syncr');
}

// Where Firefox looks for native messaging host manifests.
function resolveManifestPath() {
  if (IS_WIN) return path.join(INSTALL_DIR, 'syncr.json');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts', 'syncr.json');
  return path.join(os.homedir(), '.mozilla', 'native-messaging-hosts', 'syncr.json');
}

const INSTALL_DIR        = resolveInstallDir();
const HOST_EXE           = path.join(INSTALL_DIR, 'syncr-host.exe');   // Windows packaged host
const HOST_LAUNCHER      = IS_WIN ? HOST_EXE : path.join(INSTALL_DIR, 'host.sh');
const MANIFEST_PATH      = resolveManifestPath();
const XPI_PATH           = path.join(INSTALL_DIR, 'syncr.xpi');
const VERSION_PATH       = path.join(INSTALL_DIR, 'version.json');
const INSTALL_STATE_PATH = path.join(INSTALL_DIR, 'install.json');
const ACTS_DIR           = path.join(INSTALL_DIR, 'activities');

// Firefox extension id (Gecko) and the pinned Chromium extension id. The
// Chromium id is derived from extension/chrome-key.json via
// scripts/gen-chrome-key.js — keep both in sync if the key is ever rotated.
const FIREFOX_EXT_ID = 'syncr@clawb1t';
const CHROME_EXT_ID  = 'cpenbocpflhbgefojkkejalnbdnpgnci';

// Payload shipped inside the installer, used for offline/local setup (Linux/macOS).
const BUNDLED_HOST_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'native-host')
  : path.join(__dirname, '..', 'native-host');
const BUNDLED_XPI = app.isPackaged
  ? path.join(process.resourcesPath, 'syncr.xpi')
  : path.join(__dirname, '..', 'dist', 'syncr.xpi');

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
    if (IS_WIN) exec('taskkill /F /IM syncr-host.exe', () => resolve());
    else exec(`pkill -f "${INSTALL_DIR}/host.js"`, () => resolve());
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
  fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
    name: 'syncr',
    description: 'Syncr Native Messaging Host',
    path: HOST_LAUNCHER,
    type: 'stdio',
    allowed_extensions: [FIREFOX_EXT_ID],
  }, null, 2), 'utf8');
}

function writeRegistry() {
  // On Linux/macOS the manifest file location itself is the registration.
  if (!IS_WIN) return;
  const q = `"${MANIFEST_PATH}"`;
  execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d ${q} /f`);
}

// ─── Chromium-family native host registration ─────────────────────────────────
// Chrome/Chromium/Brave/Edge/Vivaldi/Opera all read a per-user
// NativeMessagingHosts manifest that lists the extension via `allowed_origins`
// (chrome-extension://<id>/) instead of Firefox's `allowed_extensions`.

// Per-browser user-config directories that hold a NativeMessagingHosts folder.
function chromeBrowserDirs() {
  const home = os.homedir();
  if (IS_MAC) {
    const base = path.join(home, 'Library', 'Application Support');
    return [
      path.join(base, 'Google', 'Chrome'),
      path.join(base, 'Chromium'),
      path.join(base, 'BraveSoftware', 'Brave-Browser'),
      path.join(base, 'Microsoft Edge'),
      path.join(base, 'Vivaldi'),
      path.join(base, 'com.operasoftware.Opera'),
    ];
  }
  if (IS_WIN) return []; // Windows uses the registry (handled separately).
  const base = path.join(home, '.config');
  return [
    path.join(base, 'google-chrome'),
    path.join(base, 'google-chrome-beta'),
    path.join(base, 'google-chrome-unstable'),
    path.join(base, 'chromium'),
    path.join(base, 'BraveSoftware', 'Brave-Browser'),
    path.join(base, 'microsoft-edge'),
    path.join(base, 'vivaldi'),
    path.join(base, 'opera'),
  ];
}

function chromeManifestBody() {
  return JSON.stringify({
    name: 'syncr',
    description: 'Syncr Native Messaging Host',
    path: HOST_LAUNCHER,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${CHROME_EXT_ID}/`],
  }, null, 2);
}

function writeChromeManifests() {
  const body = chromeManifestBody();

  if (IS_WIN) {
    // Write a shared manifest file and point each browser's registry key at it.
    const manifestFile = path.join(INSTALL_DIR, 'syncr-chrome.json');
    try {
      fs.mkdirSync(INSTALL_DIR, { recursive: true });
      fs.writeFileSync(manifestFile, body, 'utf8');
    } catch {}
    const q = `"${manifestFile}"`;
    const keys = [
      'Google\\Chrome', 'Chromium', 'BraveSoftware\\Brave-Browser',
      'Microsoft\\Edge', 'Vivaldi', 'Opera Software',
    ];
    for (const k of keys) {
      try {
        execSync(`reg add "HKCU\\Software\\${k}\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d ${q} /f`, { stdio: 'ignore' });
      } catch {}
    }
    return;
  }

  // Linux/macOS: drop the manifest into each browser's NativeMessagingHosts dir.
  for (const dir of chromeBrowserDirs()) {
    try {
      const nmDir = path.join(dir, 'NativeMessagingHosts');
      fs.mkdirSync(nmDir, { recursive: true });
      fs.writeFileSync(path.join(nmDir, 'syncr.json'), body, 'utf8');
    } catch {}
  }
}

// ─── Status-tray login autostart ──────────────────────────────────────────────
// Mirrors native-host/autostart.js so the tray's own toggle and this launcher
// toggle read/write the SAME session entry (host.sh --tray on login).

const AUTOSTART_ID = 'syncr-tray';

function autostartLinuxPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', `${AUTOSTART_ID}.desktop`);
}

function autostartMacPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.clawb1t.syncr.tray.plist');
}

function getAutostart() {
  try {
    if (IS_WIN) {
      execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr', { stdio: 'ignore' });
      return true;
    }
    return fs.existsSync(IS_MAC ? autostartMacPath() : autostartLinuxPath());
  } catch { return false; }
}

function setAutostart(on) {
  try {
    if (IS_WIN) {
      if (on) {
        const value = `"${HOST_LAUNCHER}" --tray`;
        execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr /t REG_SZ /d "${value.replace(/"/g, '\\"')}" /f`, { stdio: 'ignore' });
      } else {
        try { execSync('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr /f', { stdio: 'ignore' }); } catch {}
      }
    } else if (IS_MAC) {
      const file = autostartMacPath();
      if (on) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const progArgs = [HOST_LAUNCHER, '--tray'].map(a => `    <string>${a}</string>`).join('\n');
        fs.writeFileSync(file,
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clawb1t.syncr.tray</string>
  <key>ProgramArguments</key>
  <array>
${progArgs}
  </array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
`, 'utf8');
      } else {
        try { fs.rmSync(file, { force: true }); } catch {}
      }
    } else {
      const file = autostartLinuxPath();
      if (on) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file,
`[Desktop Entry]
Type=Application
Name=Syncr Status
Comment=Discord Rich Presence status for Syncr
Exec="${HOST_LAUNCHER}" --tray
Icon=syncr
Terminal=false
X-GNOME-Autostart-enabled=true
`, 'utf8');
      } else {
        try { fs.rmSync(file, { force: true }); } catch {}
      }
    }
  } catch {}
  return getAutostart();
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

  send('step', 'Registering with your browsers…');
  writeManifest();
  writeRegistry();
  writeChromeManifests();

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

// ─── Local install (Linux/macOS — bundled payload, no GitHub required) ────────

function resolveNodeBinary() {
  const tryCmd = (cmd) => {
    try {
      const out = execSync(cmd, { encoding: 'utf8' }).split('\n')[0].trim();
      return out || null;
    } catch { return null; }
  };
  const candidates = [
    tryCmd('command -v node'),
    tryCmd('command -v nodejs'),
    '/usr/bin/node', '/usr/local/bin/node', '/usr/bin/node-22', '/opt/homebrew/bin/node',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return fs.realpathSync(c); } catch {}
  }
  return null;
}

function copyHostTree() {
  const skip = new Set(['host.bat', 'host-manifest.json', 'install-linux.sh', 'host.log']);
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.cpSync(BUNDLED_HOST_DIR, INSTALL_DIR, {
    recursive: true,
    filter: (src) => !skip.has(path.basename(src)),
  });
}

// The systray2 dependency ships its Go tray binary without the exec bit; make
// the installed copy executable so the status icon can launch (Linux/macOS).
function ensureTrayBinaryExecutable() {
  if (IS_WIN) return;
  const traybin = path.join(INSTALL_DIR, 'node_modules', 'systray2', 'traybin');
  try {
    for (const f of fs.readdirSync(traybin)) {
      if (f.startsWith('tray_') && !f.endsWith('.exe')) {
        try { fs.chmodSync(path.join(traybin, f), 0o755); } catch {}
      }
    }
  } catch {}
}

async function installHostLocal() {
  send('step', 'Installing native host…');

  const nodeBin = resolveNodeBinary();
  if (!nodeBin) {
    throw new Error('Node.js runtime not found. Install Node 18+ (e.g. "sudo dnf install nodejs") and run Setup again.');
  }
  if (!fs.existsSync(BUNDLED_HOST_DIR)) {
    throw new Error('Bundled native host is missing from the installer.');
  }

  copyHostTree();
  send('progress', 0.4);

  const wrapper = `#!/bin/sh\nexec "${nodeBin}" "${path.join(INSTALL_DIR, 'host.js')}" "$@"\n`;
  fs.writeFileSync(HOST_LAUNCHER, wrapper, { mode: 0o755 });
  fs.chmodSync(HOST_LAUNCHER, 0o755);

  // npm ships the systray2 Go binary without the exec bit, which breaks the
  // status tray icon. Restore it in the installed copy (best-effort).
  ensureTrayBinaryExecutable();

  try {
    const vf = path.join(BUNDLED_HOST_DIR, 'version.json');
    if (fs.existsSync(vf)) fs.copyFileSync(vf, VERSION_PATH);
  } catch {}

  return nodeBin;
}

function installXpiLocal() {
  if (!fs.existsSync(BUNDLED_XPI)) {
    throw new Error('Bundled syncr.xpi is missing from the installer.');
  }
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  fs.copyFileSync(BUNDLED_XPI, XPI_PATH);
  const signed = isXpiSigned(XPI_PATH);
  send('step', signed ? 'Extension ready (Mozilla signed)' : 'Extension ready');
  send('progress', 0.8);
  return signed;
}

async function syncInstallLocal() {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  send('phase', 'installing');

  const nodeBin = await installHostLocal();
  const signed  = installXpiLocal();

  send('step', 'Registering with your browsers…');
  writeManifest();
  writeRegistry();
  writeChromeManifests();

  writeInstallState({
    platform:   process.platform,
    nodeBinary: nodeBin,
    signed,
    xpiSha256:  fileSha256(XPI_PATH),
    syncedAt:   new Date().toISOString(),
  });

  send('progress', 1);
  return { signed };
}

function resolveFirefox() {
  const tryCmd = (cmd) => {
    try { return execSync(cmd, { encoding: 'utf8' }).split('\n')[0].trim() || null; }
    catch { return null; }
  };
  const candidates = [
    tryCmd('command -v firefox'),
    tryCmd('command -v firefox-esr'),
    tryCmd('command -v firefox-developer-edition'),
    '/usr/bin/firefox', '/usr/local/bin/firefox',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

async function openXpiLocal(signed) {
  send('phase', 'firefox');
  send('step', signed ? 'Opening Firefox…' : 'Opening Firefox — approve the add-on to finish…');

  // Launch Firefox directly so the .xpi triggers the add-on installer.
  // (xdg-open may map .xpi to an archive manager instead of the browser.)
  const ff = IS_MAC ? null : resolveFirefox();
  if (ff) {
    try {
      spawn(ff, [XPI_PATH], { detached: true, stdio: 'ignore' }).unref();
      return;
    } catch {}
  }
  await shell.openPath(XPI_PATH);
}

// ─── IPC ──────────────────────────────────────────────────────────────────────

ipcMain.handle('window:close', () => app.quit());
ipcMain.handle('window:minimize', () => win.minimize());

ipcMain.handle('syncr:autoSetup', async () => {
  try {
    // Linux/macOS: install from the bundled payload — no GitHub release needed.
    if (!IS_WIN) {
      const { signed } = await syncInstallLocal();
      await openXpiLocal(signed);
      send('phase', 'done');
      return { ok: true, signed };
    }

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

// Launch the status-tray agent now so users immediately see it working.
function startTrayAgent() {
  try {
    const child = spawn(HOST_LAUNCHER, ['--tray'], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch { return false; }
}

ipcMain.handle('syncr:getAutostart', () => getAutostart());
ipcMain.handle('syncr:setAutostart', (_e, on) => {
  const enabled = setAutostart(!!on);
  if (enabled) startTrayAgent();
  return enabled;
});
ipcMain.handle('syncr:startTray', () => startTrayAgent());
