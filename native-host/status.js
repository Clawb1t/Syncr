'use strict';

// Single-instance tray coordination + shared status file.
//
// Any number of Syncr host processes can run at once (one per connected
// browser). To avoid duplicate tray icons, exactly one process "owns" the tray,
// decided by binding a fixed loopback port (works identically on every OS).
// Every host also mirrors its live state into status.json so the tray owner —
// which may be a standalone `--tray` agent — can display the active presence.

const fs   = require('fs');
const net  = require('net');
const path = require('path');
const { STATUS_FILE } = require('./paths');

const TRAY_LOCK_PORT = 47821; // loopback-only; picked to be unlikely to clash

// Try to become the tray owner. Resolves with a server handle (owner) or null.
function acquireTrayOwnership() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref(); // never keep the event loop alive on the lock alone
    server.once('error', () => resolve(null));
    server.listen(TRAY_LOCK_PORT, '127.0.0.1', () => resolve(server));
  });
}

function writeStatus(state) {
  const payload = JSON.stringify({
    pid: process.pid,
    updatedAt: Date.now(),
    ...state,
  });
  try {
    const tmp = STATUS_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, STATUS_FILE);
  } catch {}
}

function readStatus() {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function clearStatus(onlyIfMine = true) {
  try {
    if (onlyIfMine) {
      const cur = readStatus();
      if (cur && cur.pid !== process.pid) return;
    }
    fs.rmSync(STATUS_FILE, { force: true });
  } catch {}
}

// Watch status.json for changes written by other host processes.
function watchStatus(cb) {
  const dir  = path.dirname(STATUS_FILE);
  const base = path.basename(STATUS_FILE);
  let timer = null;
  let watcher = null;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename && filename !== base) return;
      clearTimeout(timer);
      timer = setTimeout(() => cb(readStatus()), 120);
    });
    watcher.unref?.();
  } catch {
    // Directory not watchable — fall back to light polling.
    watcher = setInterval(() => cb(readStatus()), 2000);
    watcher.unref?.();
  }
  return () => {
    clearTimeout(timer);
    try { watcher.close ? watcher.close() : clearInterval(watcher); } catch {}
  };
}

module.exports = {
  acquireTrayOwnership,
  writeStatus,
  readStatus,
  clearStatus,
  watchStatus,
  TRAY_LOCK_PORT,
};
