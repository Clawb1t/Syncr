#!/usr/bin/env bash
#
# Syncr native host installer for Linux.
#
# Installs the native messaging host into a per-user location and registers it
# with Firefox (and, when present, Flatpak Firefox / LibreWolf) so the Syncr
# extension can talk to Discord. No root required.
#
# Usage:
#   ./install-linux.sh            # install / update
#   ./install-linux.sh --uninstall
#
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="syncr@clawb1t"
# Pinned Chromium extension id (derived from extension/chrome-key.json via
# scripts/gen-chrome-key.js). Keep in sync if the signing key is ever rotated.
CHROME_EXT_ID="cpenbocpflhbgefojkkejalnbdnpgnci"
HOST_NAME="syncr"
INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/Syncr"

# Native (non-sandboxed) Firefox native-messaging-hosts directory. Firefox reads
# this on startup, so it is safe to create before Firefox has ever been run.
NM_DIR="$HOME/.mozilla/native-messaging-hosts"

# Chromium-family per-user config dirs. Each gets a NativeMessagingHosts/syncr.json
# so Chrome, Chromium, Brave, Edge, Vivaldi and Opera can reach the host too.
CHROME_DIRS=(
  "$HOME/.config/google-chrome"
  "$HOME/.config/google-chrome-beta"
  "$HOME/.config/google-chrome-unstable"
  "$HOME/.config/chromium"
  "$HOME/.config/BraveSoftware/Brave-Browser"
  "$HOME/.config/microsoft-edge"
  "$HOME/.config/vivaldi"
  "$HOME/.config/opera"
)

info() { printf '\033[36m»\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
err()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; }

manifest_json() {
  cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Syncr Native Messaging Host",
  "path": "$INSTALL_DIR/host.sh",
  "type": "stdio",
  "allowed_extensions": ["$EXT_ID"]
}
EOF
}

chrome_manifest_json() {
  cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "Syncr Native Messaging Host",
  "path": "$INSTALL_DIR/host.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$CHROME_EXT_ID/"]
}
EOF
}

uninstall() {
  info "Removing $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  # Remove the manifest from the native location plus any stale fork locations.
  for parent in "$HOME/.mozilla" "$HOME/.var/app/org.mozilla.firefox/.mozilla" \
                "$HOME/.librewolf" "$HOME/.var/app/io.gitlab.librewolf-community/.librewolf"; do
    rm -f "$parent/native-messaging-hosts/$HOST_NAME.json" 2>/dev/null || true
  done
  # Remove the Chromium-family manifests.
  for dir in "${CHROME_DIRS[@]}"; do
    rm -f "$dir/NativeMessagingHosts/$HOST_NAME.json" 2>/dev/null || true
  done
  ok "Syncr native host uninstalled."
  exit 0
}

[ "${1:-}" = "--uninstall" ] && uninstall

# ── Preconditions ─────────────────────────────────────────────────────────────
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  err "Node.js is required but was not found on PATH. Install Node 18+ and retry."
  exit 1
fi
NODE_BIN="$(readlink -f "$NODE_BIN")"
info "Using Node at $NODE_BIN ($("$NODE_BIN" -v))"

# ── Runtime dependencies ──────────────────────────────────────────────────────
if [ ! -d "$HERE/node_modules/discord-rpc" ]; then
  info "Installing native host dependencies…"
  (cd "$HERE" && npm install --omit=dev >/dev/null 2>&1)
fi

# ── Install host files ────────────────────────────────────────────────────────
info "Installing host to $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
# Copy everything except platform cruft and this installer's own build output.
cp -R "$HERE/." "$INSTALL_DIR/"
rm -f "$INSTALL_DIR/host.bat" "$INSTALL_DIR/host-manifest.json" \
      "$INSTALL_DIR/install-linux.sh" 2>/dev/null || true

# ── host.sh launcher (absolute node path so Firefox-spawned env still works) ──
cat > "$INSTALL_DIR/host.sh" <<EOF
#!/bin/sh
exec "$NODE_BIN" "$INSTALL_DIR/host.js" "\$@"
EOF
chmod +x "$INSTALL_DIR/host.sh"

# ── Make the tray (systray2) helper binary executable ─────────────────────────
# npm ships the Go tray binary without the exec bit, which breaks the status
# icon. Fix it in the installed copy (best-effort; tray is optional).
for tb in "$INSTALL_DIR"/node_modules/systray2/traybin/tray_linux_release \
          "$INSTALL_DIR"/node_modules/systray2/traybin/tray_linux*; do
  [ -f "$tb" ] && chmod +x "$tb" 2>/dev/null || true
done

# ── Register with native Firefox ──────────────────────────────────────────────
mkdir -p "$NM_DIR"
manifest_json > "$NM_DIR/$HOST_NAME.json"
ok "Registered native host with Firefox ($NM_DIR/$HOST_NAME.json)"

# ── Register with Chromium-family browsers ────────────────────────────────────
chrome_count=0
for dir in "${CHROME_DIRS[@]}"; do
  nm="$dir/NativeMessagingHosts"
  mkdir -p "$nm"
  chrome_manifest_json > "$nm/$HOST_NAME.json"
  chrome_count=$((chrome_count + 1))
done
ok "Registered native host with $chrome_count Chromium-family browser location(s)"

ok "Syncr native host installed."
echo
echo "Next steps:"
echo "  • Firefox:  load dist/syncr.xpi (about:debugging → Load Temporary Add-on)."
echo "  • Chromium/Chrome/Brave/Edge/Vivaldi/Opera:  load dist/chrome/ unpacked"
echo "    (chrome://extensions → Developer mode → Load unpacked)."
echo "  • Make sure the Discord desktop app is running."
echo "  • Browse a supported site — your Discord presence updates automatically."
