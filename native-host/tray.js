'use strict';

// Thin, defensive wrapper around systray2 (a portable Go tray binary).
//
// The tray is a live status light for the Syncr native host. It runs as a
// child process with its own stdio, so it never interferes with the Native
// Messaging protocol the host speaks to the browser over stdin/stdout.
//
// Every entry point is guarded: if the tray library or its runtime deps
// (e.g. libappindicator on Linux) are unavailable, createTray() returns null
// and the host keeps working headless — presence is never affected.

const fs   = require('fs');
const path = require('path');
const { iconFor } = require('./tray-icons');

const IS_WIN = process.platform === 'win32';

let SysTray = null;
try {
  const mod = require('systray2');
  SysTray = mod.default || mod;
} catch {
  SysTray = null;
}

// npm ships the portable Go tray binary as 0644, and systray2's own chmod call
// is broken (passes '+x' instead of an octal mode), so spawning it fails with
// EACCES. Make it executable ourselves before starting the tray.
function ensureTrayBinaryExecutable() {
  if (IS_WIN) return; // .exe needs no +x
  try {
    const dir = path.dirname(require.resolve('systray2'));
    const bin = path.join(dir, 'traybin', process.platform === 'darwin' ? 'tray_darwin_release' : 'tray_linux_release');
    fs.chmodSync(bin, 0o755);
  } catch {}
}

// status: 'active' | 'waiting' | 'idle' | 'offline'
function createTray({ onQuit, onOpenLog, onToggleAutostart, autostartEnabled } = {}) {
  if (!SysTray) return null;

  const statusItem   = { title: 'Syncr — starting…', tooltip: '', enabled: false };
  const activityItem = { title: 'No activity yet',    tooltip: '', enabled: false };
  const autostartItem = {
    title: 'Start on login',
    tooltip: 'Show the Syncr status icon automatically after you log in',
    checked: !!autostartEnabled,
    enabled: true,
  };
  const openLogItem = { title: 'Open log file', tooltip: '', enabled: true };
  const quitItem    = { title: 'Quit Syncr',    tooltip: '', enabled: true };

  const menu = {
    icon: iconFor('idle'),
    isTemplateIcon: process.platform === 'darwin',
    title: '',
    tooltip: 'Syncr',
    items: [
      statusItem,
      activityItem,
      SysTray.separator,
      autostartItem,
      openLogItem,
      SysTray.separator,
      quitItem,
    ],
  };

  let systray;
  try {
    ensureTrayBinaryExecutable();
    // copyDir extracts the binary to a writable dir — needed only for pkg (Windows).
    systray = new SysTray({ menu, debug: false, copyDir: IS_WIN });
  } catch {
    return null;
  }

  // Resolves to true when the tray is live, false if it failed — never rejects.
  const ready = systray.ready().then(() => true).catch(() => false);

  autostartItem.click = () => {
    let enabled = !autostartItem.checked;
    try { enabled = onToggleAutostart ? !!onToggleAutostart(enabled) : enabled; } catch { /* keep intent */ }
    autostartItem.checked = enabled;
    ready.then(ok => { if (ok) { try { systray.sendAction({ type: 'update-item', item: autostartItem }); } catch {} } });
  };
  openLogItem.click = () => { try { onOpenLog && onOpenLog(); } catch {} };
  quitItem.click = () => {
    ready.then(ok => { if (ok) { try { systray.kill(false); } catch {} } });
    try { onQuit && onQuit(); } catch {}
  };

  systray.onClick(action => {
    const item = action && action.item;
    if (item && typeof item.click === 'function') item.click();
  });

  function setState({ status, statusText, activityText, tooltip }) {
    if (status) menu.icon = iconFor(status);
    if (statusText) statusItem.title = statusText;
    activityItem.title = activityText || 'No activity yet';
    menu.tooltip = tooltip || 'Syncr';
    ready.then(ok => {
      if (!ok) return;
      try { systray.sendAction({ type: 'update-menu', menu }); } catch {}
    });
  }

  function setAutostartChecked(on) {
    autostartItem.checked = !!on;
    ready.then(ok => { if (ok) { try { systray.sendAction({ type: 'update-item', item: autostartItem }); } catch {} } });
  }

  function destroy() {
    ready.then(ok => { if (ok) { try { systray.kill(false); } catch {} } });
  }

  return { setState, setAutostartChecked, destroy, ready };
}

module.exports = { createTray, available: !!SysTray };
