# Extension changelog

The Firefox extension version is stored in `extension/manifest.json`. Releases are tagged on GitHub as `v1.0.x` and published to AMO as a signed `.xpi`.

**Extension version and host version are separate.** See [`host-changelog.md`](host-changelog.md) for native host history.

---

## Version history

### 1.0.12 (current)

**Shipped with:** host v1.0.8

**Activities added:**

- Netflix (`extension/activities/netflix/`)

**Changes:**

- Content script for `www.netflix.com`: browsing, search queries, title page preview, and watch playback.
- Watch pages report show season and episode, episode title, artwork, pause state, and progress via the page `<video>` element.
- Title and watch metadata fetched from Netflix's member API (same origin, logged-in session).
- Popup now-playing subtitle shows season and episode for Netflix shows.

**Discord application ID:** `1521836333528776704`

**Art asset key:** `netflix_logo` (Rich Presence art assets)

---

### 1.0.11

**Shipped with:** host v1.0.7

**Activities added:**

- Proton Mail (`extension/activities/proton-mail/`)

**Changes:**

- Privacy-first mail presence: generic labels only (no subjects, senders, or message bodies).
- Popup `getActivityTitle` supports Proton Mail context strings.

**Discord application ID:** `1521825889397112852`

---

### 1.0.10

**Shipped with:** host v1.0.6

**Changes:**

- **Dynamic activity registry:** popup merges remote GitHub registry with bundled activities on every open.
- **Stale cache fix:** registry cache shortened and keyed by extension version so new activities appear without waiting an hour.
- **Availability gating:** activity cards show locked state when `minExtensionVersion` or host presence is missing, with direct update links.
- Reddit `metadata.json` adds `minExtensionVersion: 1.0.9`.

---

### 1.0.9

**Shipped with:** host v1.0.6

**Activities added:**

- Reddit (`extension/activities/reddit/`)

**Changes:**

- Content script for `www.reddit.com` and `old.reddit.com`.
- Post pages: title, author, subreddit, score, comments, thumbnail, URLs.
- Feeds, profiles, and search: browsing mode with context.

**Discord application ID:** `1521817709388759101`

---

### 1.0.8

**Changes:**

- Extension packaging and update pipeline improvements.
- Signed XPI distribution via AMO and `updates.json`.

---

### 1.0.7

**Changes:**

- YouTube activity refinements and popup improvements.

---

### 1.0.6

**Changes:**

- Native host hot-update support wired into popup Updates panel.
- Activity registry on GitHub for remote discovery.

---

### 1.0.5

**Changes:**

- Syncr SDK adoption on the host side (paired extension updates).
- YouTube and YouTube Music presence formatting updates.

---

### 1.0.4

**Changes:**

- Initial public activity folder layout under `extension/activities/`.
- YouTube Music and YouTube content scripts.

---

### 1.0.3

**Changes:**

- First AMO-listed release with auto-update via `updates.json`.
- Core extension: background script, popup, native messaging bridge.

---

## Activities vs extension version matrix

| Activity | Min extension | Content script added in |
|---|---|---|
| YouTube Music | (bundled early) | 1.0.3 era |
| YouTube | (bundled early) | 1.0.3 era |
| Reddit | 1.0.9 | 1.0.9 |
| Proton Mail | 1.0.11 | 1.0.11 |
| Netflix | 1.0.12 | 1.0.12 |

---

## Checking the installed extension version

**Users:** Firefox → Add-ons → Syncr, or the Syncr popup header.

**Repo source of truth:**

```text
extension/manifest.json
```
