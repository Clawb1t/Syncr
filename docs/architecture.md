# Syncr architecture

This document explains how Syncr is put together: how data moves from a Firefox tab to your Discord profile, what each major file does, and how the extension and native host cooperate.

---

## Overview

Syncr has three runtime pieces:

1. **Firefox extension** (`extension/`): content scripts scrape pages; the background script manages state and talks to the host; the popup is the UI.
2. **Native host** (`native-host/` → `syncr-host.exe`): receives scraped data, formats Discord Rich Presence, sends it over Discord IPC.
3. **Syncr Setup** (`launcher/`): one-time installer that registers the native messaging host, downloads the signed extension, and seeds activity files.

Nothing passes through a Syncr cloud server. The path is always local:

```
Website tab  →  content script  →  background.js  →  syncr-host.exe  →  Discord desktop
```

---

## Native messaging protocol

Firefox spawns `syncr-host.exe` when the extension calls `browser.runtime.connectNative('syncr')`. Communication uses the **stdio native messaging protocol**:

1. Every message is UTF-8 JSON.
2. Messages are framed with a **4-byte little-endian length prefix** followed by the JSON body.
3. The host reads from `stdin`, writes replies to `stdout`.
4. Logs go to `stderr` and `%LOCALAPPDATA%\Syncr\host.log`.

Registration lives in the Windows registry:

```
HKCU\Software\Mozilla\NativeMessagingHosts\syncr
  → points to %LOCALAPPDATA%\Syncr\syncr.json
```

`syncr.json` contains the path to `syncr-host.exe` and the allowed extension ID (`syncr@clawb1t`).

### Message types (extension → host)

| `type` | Payload | Host behavior |
|---|---|---|
| `activity:update` | `{ activityId, data }` | Look up activity, call `formatPresence(data)`, `SET_ACTIVITY` on Discord |
| `activity:clear` | `{ activityId }` | Clear presence for that activity's `clientId` |
| `host:checkUpdates` | `{ apply?: boolean }` | Fetch GitHub registry, optionally hot-update `presence.js` files, report host/activity versions |

### Message types (host → extension)

| `type` | Payload | Extension behavior |
|---|---|---|
| `host:updateResult` | `{ updatedActivities, activityStatus, hostUpdate, hostVersion }` | Stored in `connState.updateInfo` for the popup |

Implementation: `native-host/host.js` (read/write framing), `extension/background/background.js` (`connectNative`, `port.postMessage`).

---

## Extension: content scripts

**Location:** `extension/activities/{id}/content-script.js`

Content scripts are declared in `extension/manifest.json` under `content_scripts`. Firefox injects them only on matching URLs (e.g. `*://www.reddit.com/*`).

Each script:

1. Polls the page (typically every 2 seconds) or reacts to navigation events.
2. Calls `scrape()` to build a plain JSON `data` object.
3. Sends updates to the background script:

```javascript
browser.runtime.sendMessage({
  type: 'activity:update',
  activityId: 'reddit',
  data: { title, author, subreddit, ... },
});
```

4. Sends `activity:clear` when the user leaves the site or the tab unloads.

Content scripts must **not** talk to Discord directly. They only scrape and message the background.

---

## Extension: background script

**Location:** `extension/background/background.js`

### Multi-activity tracking

The background keeps a `liveActivities` map:

```
activityId → { data, tabId, origin, startedAt }
```

Multiple activities can be live at once (e.g. YouTube and YouTube Music). Only one **transmits** to Discord at a time.

### Priority logic (`pickTransmitting`)

1. User's saved **preferred** activity (from popup "Switch" button), if live.
2. Currently transmitting activity, if still live (stability).
3. Oldest live activity by `startedAt`.

When the transmitting activity changes, the background clears the old activity on the host, then sends the new one's latest data.

### Disabled activities

Users can toggle activities off in the popup. Disabled IDs are stored in `browser.storage.local` (`disabledActivities`). Updates from disabled activities are ignored.

### Tab lifecycle

- **Tab closed:** clear any live activity tied to that `tabId`.
- **URL origin change:** clear activity if the tab navigates away from the site's origin (e.g. reddit.com → google.com).

### Native host connection

- Connects on startup via `connectNative('syncr')`.
- Reconnects every 5 seconds on disconnect.
- `host:forceReconnect` from popup disconnects and reconnects (used after Setup or troubleshooting).

Only the **transmitting** activity's updates are forwarded to the host (`flushTransmitting`).

---

## Extension: popup

**Location:** `extension/popup/popup.js`, `popup.html`, `popup.css`

### Activity registry

On open, the popup:

1. Loads bundled IDs from `extension/activities/registry.json`.
2. Fetches the remote registry from GitHub (`extension/activities/registry.json` on `main`).
3. Merges both lists and fetches `metadata.json` per activity.
4. Caches results in `browser.storage.local` (`_registryCache`) for fast re-open, but **always revalidates in the background**.

### Availability gating

Each activity card checks:

| Check | Meaning |
|---|---|
| Bundled scraper, remote scraper, or `minExtensionVersion` | Extension can run the activity |
| `browser.permissions.contains` for `origins` | User granted site access |
| Host `activityStatus` installed + upToDate | `presence.js` is on disk and matches GitHub |

Locked activities show why (extension update vs host update) and link to the fix. Enabled activities without permission show **Allow access**.

### Dynamic activity injection (v1.0.13+)

**Location:** `extension/background/activity-injector.js`

**Bundled activities** (YouTube, Netflix, Reddit, etc.) use manifest `content_scripts` for reliable scraping.

**Remote activities** (`scraper: "remote"` in `metadata.json`, e.g. Proton Mail):

1. User enables the activity and grants site access in the popup.
2. On tab load, the injector matches the URL and injects `activities/_runtime/runner.js`.
3. The runner fetches `scraper.json` from GitHub.

See [`docs/scraper-schema.md`](scraper-schema.md).

### Updates panel

Compares local extension version, remote `manifest.json` version, and host `version.json` on GitHub. **Check for updates** sends `host:checkUpdates` with `apply: true` to hot-download `presence.js` files.

---

## Native host: activity loader

**Location:** `native-host/activity-loader.js`

At startup, scans `%LOCALAPPDATA%\Syncr\activities/` (or `native-host/activities/` in dev):

```
activities/
  reddit/
    presence.js
  youtube/
    presence.js
  ...
```

Rules:

- One folder per activity ID.
- Each folder must contain `presence.js`.
- Folders starting with `_` are skipped (`_template`).

Each `presence.js` must export:

```javascript
{
  id, name, clientId, urlPattern,
  formatPresence(data, syncr) { ... }
}
```

The loader wraps `formatPresence` so the **Syncr SDK** (`syncr`) is always passed as the second argument, even if the module only declares one parameter.

---

## Native host: Syncr SDK

**Location:** `native-host/sdk/`

Bundled inside `syncr-host.exe` via `pkg`. Activity authors use it only in `presence.js` (injected by the loader).

Key pieces:

| Module | Role |
|---|---|
| `sdk/presence.js` | `PresenceBuilder`: `.watching()`, `.listening()`, `.details()`, `.largeImage()`, `.button()`, etc. |
| `sdk/helpers.js` | `browsing()`, `progressBar()`, `truncate()` |
| `sdk/validate.js` | Field length limits, URL sanitization, `validatePresence()` |
| `sdk/types.js` | `ActivityType` constants (Playing, Listening, Watching, ...) |

Full API reference: [`native-host/ACTIVITY_SDK.md`](../native-host/ACTIVITY_SDK.md).

**Important:** SDK changes require a **new host binary**. Activity-only changes only need a new `presence.js` on GitHub (hot-update).

---

## Native host: RPC manager

**Location:** `native-host/rpc-manager.js`

Uses `discord-rpc` to connect to the Discord desktop app's IPC pipe. One client per Discord **Application ID** (`clientId`).

Why not `client.setActivity()`? The library strips the `type` field, which forces everything to show as "Playing a game". Syncr calls `client.request('SET_ACTIVITY', ...)` directly so activities can be **Listening**, **Watching**, etc.

Flow for `setActivity(clientId, presence)`:

1. Validate/normalize via `getSyncr().validatePresence()`.
2. If the primary image URL changed, clear activity briefly (Discord image cache workaround).
3. Send `SET_ACTIVITY` with `pid` and the activity object.

When switching between activities with different `clientId`s, the previous client's presence is cleared first.

---

## Native host: updater

**Location:** `native-host/updater.js`

Runs on:

- Host startup (after 4 second delay, `apply: true`).
- Popup **Check for updates** (`host:checkUpdates`).

### Activity hot-update

1. Fetch `extension/activities/registry.json` from GitHub.
2. For each activity ID, download `native-host/activities/{id}/presence.js`.
3. Compare SHA-256 with local file in `%LOCALAPPDATA%\Syncr\activities/{id}/presence.js`.
4. If different, write atomically and reload into the running host's activity map.

### Host version check

Compares local `%LOCALAPPDATA%\Syncr\version.json` to `native-host/version.json` on GitHub `main`. If remote is newer, reports `hostUpdate.available` with download URLs from the latest GitHub Release (`syncr-host.exe`, Syncr Setup).

Host version is **independent** from the extension version number.

---

## Native host: paths

**Location:** `native-host/paths.js`

When packaged with `pkg`, `__dirname` is read-only. All writable files live next to the exe:

| Path | Purpose |
|---|---|
| `%LOCALAPPDATA%\Syncr\syncr-host.exe` | Host binary |
| `%LOCALAPPDATA%\Syncr\activities/` | Hot-updated `presence.js` files |
| `%LOCALAPPDATA%\Syncr\version.json` | Installed host version |
| `%LOCALAPPDATA%\Syncr\host.log` | Debug log |

---

## Syncr Setup (launcher)

**Location:** `launcher/main.js`

Electron installer that:

1. Creates `%LOCALAPPDATA%\Syncr\`.
2. Downloads latest `syncr-host.exe`, `syncr.xpi`, and activity `presence.js` files from GitHub.
3. Writes the native messaging manifest and registry key.
4. Verifies the XPI is Mozilla-signed before installing.

Re-running Setup refreshes all artifacts. Users only need Setup again when the **host binary** or extension must be replaced.

---

## Discord applications

Each activity uses its **own** Discord Application (`clientId` in `presence.js`). That controls:

- The name shown on your profile ("YouTube Music", "Reddit", not "Syncr").
- Rich Presence art assets uploaded under **Rich Presence → Art Assets** for that app.

No OAuth or client secret is needed. The host uses local Discord IPC.

---

## Release artifacts

| Artifact | Source | User update path |
|---|---|---|
| `syncr.xpi` | AMO-signed, GitHub Releases | Firefox `updates.json` auto-update or manual install |
| `syncr-host.exe` | `pkg` build, GitHub Releases | Syncr Setup or direct exe download when host version bumps |
| `presence.js` per activity | GitHub `main` | Host hot-updater (popup Check for updates) |
| Activity registry/metadata | GitHub `main` | Popup fetches on open |

See [`host-changelog.md`](host-changelog.md) for what changed in each host version and [`activities.md`](activities.md) for how to add and ship new activities.
