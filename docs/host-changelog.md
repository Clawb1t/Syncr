# Native host changelog

The native host is `syncr-host.exe`. Its version is stored in `native-host/version.json` in the repo and copied to `%LOCALAPPDATA%\Syncr\version.json` on install.

**Host version and extension version are separate.** Extension releases use tags like `v1.0.11`. Host releases use `native-host/version.json` (currently `1.0.7`). Users see both in the popup Updates panel.

---

## What updates how

| Change type | Needs new host exe? | Needs new extension XPI? | User action |
|---|---|---|---|
| Edit `presence.js` for an activity | No | No | Check for updates in popup (or wait for auto hot-update on host start) |
| New activity `presence.js` on GitHub | No | No | Check for updates (host downloads new file) |
| New content script / manifest entry | No* | **Yes** | Install new extension from Releases or Firefox auto-update |
| SDK change (`native-host/sdk/`) | **Yes** | No | Run Syncr Setup or download new `syncr-host.exe` |
| Host bug fix in `host.js`, `rpc-manager.js`, etc. | **Yes** | No | Run Syncr Setup or download new `syncr-host.exe` |

\*The host can load a new `presence.js` immediately, but the extension cannot scrape the site until the content script ships in an XPI.

---

## Version history

### 1.0.7 (current)

**Shipped with:** extension v1.0.11

**Activities in repo:**

- YouTube Music
- YouTube
- Reddit
- Proton Mail

**Notes:**

- Version bump alongside Proton Mail `presence.js`.
- No SDK or host core changes in this bump; activity formatting only.

---

### 1.0.6

**Shipped with:** extension v1.0.9 / v1.0.10

**Activities added:**

- Reddit (`native-host/activities/reddit/presence.js`)

**Notes:**

- Reddit presence: Watching type, post title, subreddit, author, score, comment count, two RPC buttons.
- Paired with extension content script for `www.reddit.com` and `old.reddit.com`.

---

### 1.0.5

**Commit:** `Host v1.0.5`

**Capabilities:**

- **`sdk-loader.js`**: reliable SDK loading when bundled with `pkg` (string-literal `require` for the bundler).
- **`activity-loader.js`**: automatically injects the Syncr SDK as the second argument to every `formatPresence`.
- **RPC manager** uses `validatePresence()` from the SDK before `SET_ACTIVITY`.
- IPC test helper added (later removed from repo).

**Activities:** YouTube, YouTube Music, `_template`

**Notes:**

- This is the first host version where all activities are expected to use the fluent SDK (`syncr.presence().watching()...`) rather than raw Discord field names.

---

### 1.0.4

**Commit:** `hotfix`

**Changes:**

- Activity loader robustness fixes.
- `package.json` / build tooling adjustments for `pkg`.

**Notes:**

- Patch release between SDK rollout and the 1.0.5 loader improvements.

---

### 1.0.3

**Commit:** `update` (large refactor)

**Major additions:**

- **Syncr SDK** (`native-host/sdk/`): `PresenceBuilder`, `browsing()`, `progressBar()`, validation, activity type constants.
- **`ACTIVITY_SDK.md`**: author documentation for `presence.js`.
- **`paths.js`**: correct writable paths when running as packaged exe (`%LOCALAPPDATA%\Syncr`).
- **Activity folder layout**: `activities/{id}/presence.js` with `_template` starter.
- Activities refactored to SDK-based `formatPresence(data, syncr)`.

**Activities:** YouTube, YouTube Music, `_template`

**Breaking change for activity authors:** `presence.js` must use the SDK shape. Old flat export style is no longer used.

---

### 1.0.2

**Shipped with:** extension Release v1.0.5 era

**Capabilities:**

- Native messaging host with Discord IPC.
- Activity loader scanning `activities/{id}/presence.js`.
- RPC manager with direct `SET_ACTIVITY` (Listening / Watching types).
- Updater fetching `presence.js` from GitHub.

**Activities:** YouTube, YouTube Music

---

### 1.0.0

**Commit:** `updates system`

**Initial host update infrastructure:**

- **`version.json`**: host version tracking separate from extension.
- **`updater.js`**: fetch registry from GitHub, SHA-256 compare, atomic write of `presence.js` files.
- **`host:checkUpdates`** message and `host:updateResult` reply.
- **Background update** 4 seconds after host start.
- **Popup Updates UI** wired to host status.

**Activities:** YouTube, YouTube Music (folder layout)

---

## Activities vs host version matrix

| Activity | Min extension | Host presence required | Added in host |
|---|---|---|---|
| YouTube Music | (bundled early) | `youtube-music/presence.js` | 1.0.0 |
| YouTube | (bundled early) | `youtube/presence.js` | 1.0.0 |
| Reddit | 1.0.9 | `reddit/presence.js` | 1.0.6 |
| Proton Mail | 1.0.11 | `proton-mail/presence.js` | 1.0.7 |

---

## Checking the installed host version

**Users:** Syncr popup → Updates → Host installed version.

**Developers:**

```text
%LOCALAPPDATA%\Syncr\version.json
```

**Repo source of truth:**

```text
native-host/version.json
```

When publishing a host-only fix, bump `native-host/version.json` and run:

```powershell
.\update.ps1 -HostOnly
```

That pushes source to `main` and uploads `syncr-host.exe` to the latest GitHub Release.
