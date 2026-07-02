'use strict';

// Cross-platform "launch on login" toggle for the Syncr status tray.
//
// The tray runs the native host in standalone agent mode (`host.sh --tray`,
// or `syncr-host.exe --tray` on Windows). Enabling autostart registers that
// command with the OS session so the tray is always available after login.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { BASE_DIR } = require('./paths');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

const APP_ID    = 'syncr-tray';
const APP_LABEL = 'Syncr Status';

// The command that launches the tray agent, resolved from the install dir.
function trayCommand() {
  if (IS_WIN) {
    return { exec: path.join(BASE_DIR, 'syncr-host.exe'), args: ['--tray'] };
  }
  const sh = path.join(BASE_DIR, 'host.sh');
  return { exec: sh, args: ['--tray'] };
}

// ── Linux (XDG autostart .desktop) ────────────────────────────────────────────

function linuxDesktopPath() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', `${APP_ID}.desktop`);
}

function linuxEnable() {
  const { exec, args } = trayCommand();
  const file = linuxDesktopPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content =
`[Desktop Entry]
Type=Application
Name=${APP_LABEL}
Comment=Discord Rich Presence status for Syncr
Exec="${exec}" ${args.join(' ')}
Icon=syncr
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(file, content, 'utf8');
}

function linuxDisable() {
  try { fs.rmSync(linuxDesktopPath(), { force: true }); } catch {}
}

function linuxIsEnabled() {
  return fs.existsSync(linuxDesktopPath());
}

// ── macOS (LaunchAgent plist) ─────────────────────────────────────────────────

function macPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.clawb1t.syncr.tray.plist');
}

function macEnable() {
  const { exec, args } = trayCommand();
  const file = macPlistPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const progArgs = [exec, ...args]
    .map(a => `    <string>${a}</string>`)
    .join('\n');
  const content =
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
`;
  fs.writeFileSync(file, content, 'utf8');
}

function macDisable() {
  try { fs.rmSync(macPlistPath(), { force: true }); } catch {}
}

function macIsEnabled() {
  return fs.existsSync(macPlistPath());
}

// ── Windows (HKCU Run key) ────────────────────────────────────────────────────

function winRun(cmd) {
  const { execSync } = require('child_process');
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
}

function winEnable() {
  const { exec, args } = trayCommand();
  const value = `"${exec}" ${args.join(' ')}`;
  winRun(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr /t REG_SZ /d "${value.replace(/"/g, '\\"')}" /f`);
}

function winDisable() {
  try { winRun('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr /f'); } catch {}
}

function winIsEnabled() {
  try {
    winRun('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v Syncr');
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

function enable()    { IS_WIN ? winEnable()  : IS_MAC ? macEnable()  : linuxEnable(); }
function disable()   { IS_WIN ? winDisable() : IS_MAC ? macDisable() : linuxDisable(); }
function isEnabled() { return IS_WIN ? winIsEnabled() : IS_MAC ? macIsEnabled() : linuxIsEnabled(); }

function setEnabled(on) {
  if (on) enable(); else disable();
  return isEnabled();
}

module.exports = { enable, disable, isEnabled, setEnabled, trayCommand };
