'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const { execSync } = require('child_process');

// ─── Constants ────────────────────────────────────────────────────────────────

const INSTALL_DIR   = 'C:\\ProgramData\\Syncr';
const HOST_EXE      = path.join(INSTALL_DIR, 'syncr-host.exe');
const MANIFEST_PATH = path.join(INSTALL_DIR, 'syncr.json');
const XPI_PATH      = path.join(INSTALL_DIR, 'syncr.xpi');
const VERSION_PATH  = path.join(INSTALL_DIR, 'version.json');
const ACTS_DIR      = path.join(INSTALL_DIR, 'activities');

const GITHUB_API  = 'https://api.github.com/repos/Clawb1t/Syncr/releases/latest';
const GITHUB_RAW  = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const ACTIVITIES  = ['youtube', 'youtube-music'];

// ─── Window ───────────────────────────────────────────────────────────────────

let win;

function createWindow() {
  win = new BrowserWindow({
    width:  480,
    height: 620,
    frame:  false,
    resizable: false,
    backgroundColor: '#0f0f17',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

function log(msg) { send('log', msg); }

/** HTTPS GET with redirect following, returns Buffer */
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Syncr-Launcher/1.0' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        return resolve(fetchBuffer(res.headers.location));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/** Download a URL to a file, calling onProgress(0-1) as bytes arrive */
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    function doRequest(url) {
      const mod = url.startsWith('https') ? https : http;
      mod.get(url, { headers: { 'User-Agent': 'Syncr-Launcher/1.0' } }, res => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
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
            fs.renameSync(tmp, dest);
            resolve();
          });
        });
        file.on('error', err => { fs.unlinkSync(tmp); reject(err); });
        res.on('error', reject);
      }).on('error', reject);
    }
    doRequest(url);
  });
}

/** Write the native messaging manifest */
function writeManifest() {
  const json = JSON.stringify({
    name: 'syncr',
    description: 'Syncr Native Messaging Host',
    path: HOST_EXE,
    type: 'stdio',
    allowed_extensions: ['syncr@clawb1t'],
  }, null, 2);
  fs.writeFileSync(MANIFEST_PATH, json, 'utf8');
}

/** Write registry keys so Firefox can find the native host */
function writeRegistry() {
  const escaped = MANIFEST_PATH.replace(/\\/g, '\\\\');
  const q = `"${MANIFEST_PATH}"`;
  execSync(`reg add "HKLM\\SOFTWARE\\Mozilla\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d ${q} /f`);
  execSync(`reg add "HKLM\\SOFTWARE\\WOW6432Node\\Mozilla\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d ${q} /f`);
  void escaped; // suppress lint
}

/** Check current install state */
function getInstallState() {
  const hostExists    = fs.existsSync(HOST_EXE);
  const xpiExists     = fs.existsSync(XPI_PATH);
  const manifestExists = fs.existsSync(MANIFEST_PATH);

  let installedVersion = null;
  if (fs.existsSync(VERSION_PATH)) {
    try { installedVersion = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf8')).version; } catch {}
  }

  return { hostExists, xpiExists, manifestExists, installedVersion };
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('window:close',    () => win.close());
ipcMain.handle('window:minimize', () => win.minimize());

ipcMain.handle('syncr:check', async () => {
  const state = getInstallState();

  let latestVersion = null;
  let assets = {};

  try {
    log('Checking GitHub for latest release…');
    const raw = await fetchBuffer(GITHUB_API);
    const release = JSON.parse(raw.toString());
    latestVersion = release.tag_name?.replace(/^v/, '') ?? null;

    for (const a of (release.assets || [])) {
      if (a.name === 'syncr-host.exe') assets.host = a.browser_download_url;
      if (a.name === 'syncr.xpi')      assets.xpi  = a.browser_download_url;
    }
    log(`Latest release: v${latestVersion}`);
  } catch (e) {
    log(`Could not reach GitHub: ${e.message}`);
  }

  return { ...state, latestVersion, assets };
});

async function doInstall({ assets } = {}) {
  try {
    // Directories
    fs.mkdirSync(INSTALL_DIR, { recursive: true });
    for (const act of ACTIVITIES) {
      fs.mkdirSync(path.join(ACTS_DIR, act), { recursive: true });
    }

    // Download host exe
    if (assets?.host) {
      log('Downloading syncr-host.exe…');
      await downloadFile(assets.host, HOST_EXE, p => send('progress', p * 0.5));
      log('syncr-host.exe downloaded.');
    } else {
      throw new Error('No syncr-host.exe asset found in the latest release. Please upload it to GitHub releases.');
    }

    // Download activities
    for (let i = 0; i < ACTIVITIES.length; i++) {
      const act = ACTIVITIES[i];
      const url = `${GITHUB_RAW}/native-host/activities/${act}/presence.js`;
      log(`Downloading ${act}/presence.js…`);
      const buf = await fetchBuffer(url);
      fs.writeFileSync(path.join(ACTS_DIR, act, 'presence.js'), buf);
      send('progress', 0.5 + (i + 1) / ACTIVITIES.length * 0.25);
    }

    // Download XPI
    if (assets?.xpi) {
      log('Downloading syncr.xpi…');
      await downloadFile(assets.xpi, XPI_PATH, p => send('progress', 0.75 + p * 0.15));
      log('syncr.xpi downloaded.');
    } else {
      throw new Error('No syncr.xpi asset found in the latest release. Please upload it to GitHub releases.');
    }

    // Download version.json
    try {
      const vBuf = await fetchBuffer(`${GITHUB_RAW}/native-host/version.json`);
      fs.writeFileSync(VERSION_PATH, vBuf);
    } catch {}

    send('progress', 0.95);

    // Write manifest + registry
    log('Writing native messaging manifest…');
    writeManifest();
    log('Registering native messaging host…');
    writeRegistry();

    send('progress', 1);
    log('Installation complete!');

    // Open XPI in Firefox
    log('Opening Firefox extension installer…');
    await shell.openPath(XPI_PATH);

    return { ok: true };
  } catch (e) {
    log(`Error: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

ipcMain.handle('syncr:install', async (_e, payload) => doInstall(payload));

ipcMain.handle('syncr:update', async (_e, payload) => {
  // Same as install — just overwrites existing files
  return doInstall(payload);
});
