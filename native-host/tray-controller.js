'use strict';

// Orchestrates the status tray: single-instance ownership, the status file that
// lets a standalone agent mirror browser-spawned hosts, autostart wiring, and
// translation of host state into a tray icon colour + labels.
//
// Fully self-contained and defensive — any failure here must never affect the
// Native Messaging bridge, so host.js wraps startStatusTray() in try/catch.

const { spawn } = require('child_process');
const { LOG_FILE } = require('./paths');
const { createTray } = require('./tray');
const autostart = require('./autostart');
const {
  acquireTrayOwnership,
  writeStatus,
  readStatus,
  clearStatus,
  watchStatus,
} = require('./status');

const HEARTBEAT_MS = 20000;
const STALE_MS     = 60000;

function openPath(p) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', p], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [p], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [p], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {}
}

function safeAutostartEnabled() {
  try { return autostart.isEnabled(); } catch { return false; }
}

function activityLine(a) {
  if (!a) return 'No activity yet';
  const base = a.name || a.id || 'Activity';
  return a.details ? `${base} — ${a.details}` : base;
}

function computeDisplay(state) {
  if (!state || !state.running) {
    return { status: 'offline', statusText: 'Syncr — no browser connected', activityText: 'Open Firefox or Chrome to start', tooltip: 'Syncr — offline' };
  }
  if (state.activity) {
    if (state.discord) {
      return { status: 'active', statusText: 'Syncr — showing on Discord', activityText: activityLine(state.activity), tooltip: `Syncr — ${state.activity.name || state.activity.id}` };
    }
    return { status: 'waiting', statusText: 'Syncr — Discord not detected', activityText: activityLine(state.activity), tooltip: 'Syncr — start the Discord app' };
  }
  if (state.discord) {
    return { status: 'idle', statusText: 'Syncr — connected to Discord', activityText: 'Waiting for a supported tab', tooltip: 'Syncr — connected' };
  }
  return { status: 'idle', statusText: 'Syncr — running', activityText: 'Waiting for a supported tab', tooltip: 'Syncr — running' };
}

function startStatusTray({ agentMode = false, onQuit } = {}) {
  const myState = { running: true, discord: false, activity: null };
  let tray = null;
  let owner = null;
  let stopWatch = null;
  let retryTimer = null;
  let heartbeat = null;

  function publicState() {
    return { running: true, discord: myState.discord, activity: myState.activity };
  }

  function renderOwn() {
    if (tray) tray.setState(computeDisplay(myState));
  }

  function renderFromStatus(st) {
    if (!tray) return;
    if (!st || (st.updatedAt && Date.now() - st.updatedAt > STALE_MS)) {
      tray.setState(computeDisplay({ running: false }));
      return;
    }
    tray.setState(computeDisplay({ running: true, discord: st.discord, activity: st.activity }));
  }

  function createTrayNow() {
    tray = createTray({
      autostartEnabled: safeAutostartEnabled(),
      onToggleAutostart: (enabled) => {
        try { return autostart.setEnabled(enabled); } catch { return safeAutostartEnabled(); }
      },
      onOpenLog: () => openPath(LOG_FILE),
      onQuit: () => teardownAndQuit(),
    });
    if (!tray) return;
    if (agentMode) {
      renderFromStatus(readStatus());
      if (!stopWatch) stopWatch = watchStatus(renderFromStatus);
    } else {
      renderOwn();
    }
  }

  async function tryBecomeOwner() {
    if (owner) return true;
    owner = await acquireTrayOwnership();
    if (owner) { createTrayNow(); return true; }
    return false;
  }

  async function init() {
    const got = await tryBecomeOwner();
    // A standalone agent keeps trying to take over the tray when a
    // browser-spawned owner exits, so the login tray stays persistent.
    if (!got && agentMode) {
      retryTimer = setInterval(() => {
        tryBecomeOwner().then(ok => { if (ok && retryTimer) { clearInterval(retryTimer); retryTimer = null; } });
      }, 3000);
      retryTimer.unref && retryTimer.unref();
    }
    if (!agentMode) {
      writeStatus(publicState());
      heartbeat = setInterval(() => writeStatus(publicState()), HEARTBEAT_MS);
      heartbeat.unref && heartbeat.unref();
    }
  }

  function teardownTray() {
    try { if (tray) tray.destroy(); } catch {}
    try { if (stopWatch) stopWatch(); } catch {}
    try { if (owner) owner.close(); } catch {}
    try { if (retryTimer) clearInterval(retryTimer); } catch {}
    try { if (heartbeat) clearInterval(heartbeat); } catch {}
    tray = null; owner = null; stopWatch = null; retryTimer = null; heartbeat = null;
  }

  function teardownAndQuit() {
    teardownTray();
    if (!agentMode) { try { clearStatus(); } catch {} }
    if (typeof onQuit === 'function') { try { onQuit(); return; } catch {} }
    if (agentMode) process.exit(0);
  }

  // Public API used by host.js
  const api = {
    setDiscord(connected) {
      if (agentMode) return;
      myState.discord = !!connected;
      writeStatus(publicState());
      if (owner) renderOwn();
    },
    setActivity(info) {
      if (agentMode) return;
      myState.activity = info || null;
      writeStatus(publicState());
      if (owner) renderOwn();
    },
    shutdown() {
      teardownTray();
      if (!agentMode) { try { clearStatus(); } catch {} }
    },
  };

  init().catch(() => {});
  return api;
}

module.exports = { startStatusTray };
