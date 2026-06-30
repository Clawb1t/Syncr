/**
 * Syncr Setup Server
 * Serves the setup wizard UI and handles install actions via a local HTTP API.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

const PORT = 47820;
const UI_DIR = path.join(__dirname, 'ui');
const NATIVE_HOST_DIR = path.join(__dirname, '..', 'native-host');
const EXTENSION_DIR = path.join(__dirname, '..', 'extension');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJSON(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'text/plain';
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
}

function isRegistered() {
  try {
    if (process.platform === 'win32') {
      execSync('reg query "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\syncr"', { stdio: 'pipe' });
      return true;
    }
    const p = process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts', 'syncr.json')
      : path.join(os.homedir(), '.mozilla', 'native-messaging-hosts', 'syncr.json');
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function handleStatus() {
  let nodeVersion = null;
  let nodeOk = false;
  try {
    nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
    nodeOk = parseInt(nodeVersion.replace('v', '')) >= 16;
  } catch {}

  return {
    nodeVersion,
    nodeOk,
    platform: process.platform,
    isRegistered: isRegistered(),
    extensionPath: path.join(EXTENSION_DIR, 'manifest.json').replace(/\\/g, '/'),
  };
}

function handleInstall() {
  try {
    // Install npm deps for native host
    execSync('npm install --omit=dev', {
      cwd: NATIVE_HOST_DIR,
      stdio: 'pipe',
      timeout: 60000,
    });

    // Resolve launcher path
    const launcherPath = process.platform === 'win32'
      ? path.join(NATIVE_HOST_DIR, 'host.bat')
      : path.join(NATIVE_HOST_DIR, 'host.sh');

    // Write a launcher that uses the FULL path to the current node executable.
    // Firefox inherits the system PATH (not the user shell PATH) when it spawns
    // native hosts, so `node` might not resolve. process.execPath is always the
    // absolute path to the node binary that is running this setup server.
    const nodeBin = process.execPath;
    const hostJs  = path.join(NATIVE_HOST_DIR, 'host.js');

    if (process.platform === 'win32') {
      fs.writeFileSync(
        launcherPath,
        `@echo off\r\n"${nodeBin}" "${hostJs}" %*\r\n`,
        'utf8'
      );
    } else {
      fs.writeFileSync(
        launcherPath,
        `#!/bin/sh\nexec "${nodeBin}" "${hostJs}" "$@"\n`,
        'utf8'
      );
      try { fs.chmodSync(launcherPath, 0o755); } catch {}
    }

    // Write manifest with resolved absolute path
    const manifest = {
      name: 'syncr',
      description: 'Syncr native messaging host — Discord Rich Presence bridge',
      path: launcherPath,
      type: 'stdio',
      allowed_extensions: ['syncr@syncr.local'],
    };
    const manifestPath = path.join(NATIVE_HOST_DIR, 'host-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Register with Firefox
    if (process.platform === 'win32') {
      execSync(
        `reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\syncr" /ve /t REG_SZ /d "${manifestPath}" /f`,
        { stdio: 'pipe' }
      );
    } else if (process.platform === 'darwin') {
      const dir = path.join(os.homedir(), 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(dir, 'syncr.json'));
    } else {
      const dir = path.join(os.homedir(), '.mozilla', 'native-messaging-hosts');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(manifestPath, path.join(dir, 'syncr.json'));
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return sendJSON(res, handleStatus());
  }

  if (url.pathname === '/api/install' && req.method === 'POST') {
    return sendJSON(res, handleInstall());
  }

  const filePath = path.join(UI_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  serveFile(res, filePath);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`\nSyncr Setup → ${url}\n`);

  const open = process.platform === 'win32' ? `start "" "${url}"` :
               process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(open);
});
