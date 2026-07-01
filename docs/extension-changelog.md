# Extension changelog

The Firefox extension version is stored in `extension/manifest.json`. Releases are tagged on GitHub as `v1.0.x` and published to AMO as a signed `.xpi`.

**Extension version and host version are separate.** See [`host-changelog.md`](host-changelog.md) for native host history.

---

## Version history

### 1.0.22 (current)

**Proton Mail fix + engine version in Settings**

- Migrated Proton Mail `scraper.json` to engine **v2** (was still on v1 compat path after the v2 rollout).
- Universal host now uses `window.SyncrEngine` consistently and re-resolves when the tab origin changes.
- v1 compat shim handles `default.emit` wrappers (fixes broken payloads if a remote scraper mixed v1/v2 shape).
- Settings → About shows **Scraper engine** version (separate from extension version).

---

### 1.0.21

**Hotfix: manifest warning**

- Removed non-standard `syncr` key from `manifest.json` (Firefox warned on load). Engine version now lives in [`extension/engine-version.json`](extension/engine-version.json).
- Removed stale `renderPermissionBanner()` call in popup boot.

---

### 1.0.20

**Scraper Engine v2 — all activities are GitHub-only**

- **Engine v2.0.0** (`extension/activities/_runtime/engine/`): declarative extractors, profiles, video timing, `fetchJson`, change detection, Netflix helpers.
- **Migrated to remote `scraper.json`:** YouTube, YouTube Music, Reddit, Netflix (no bundled `content-script.js`).
- **Single universal content script** on all http(s) pages; per-site manifest entries removed.
- Popup gates activities on `minEngineVersion` vs `extension/engine-version.json` (not bundled scraper presence).
- Proton Mail uses v2 `scraper.json` (migrated in 1.0.22).
- Added `npm run validate:scrapers` and `npm run test:engine`.

**After updating:** reload the extension. New activities only need GitHub files (`registry.json`, `metadata.json`, `scraper.json`, `presence.js`).

---

### 1.0.19

**Hotfix: remote URL matching was completely broken**

- `patternToRegex()` produced invalid regex for `*://mail.proton.me/*` patterns (`*` was never converted to `.*`), so `activity:resolveForUrl` threw on every Proton Mail tab and the universal host never started.
- Remote resolve no longer filters disabled activities at match time (the scraper polls `activity:isEnabled` instead, so toggling on works without a tab refresh).
- Universal host re-resolves on SPA navigation (`pushState` / `hashchange`) for login redirects.
- Proton Mail origins include bare `mail.proton.me` URLs without a trailing path.
- `scraper.json` loads from bundle first, GitHub second.

**After updating:** reload the extension, then refresh `mail.proton.me`.

---

### 1.0.18

**PreMiD-style universal remote host (fixes Proton Mail)**

- Universal manifest content script (`activities/_runtime/universal.js`) runs on all http(s) pages and resolves remote activities by URL, like PreMiD's per-page injection model but using declarative `scraper.json` instead of remote JS (AMO policy).
- Background merges **bundled** remote index with GitHub registry so Proton Mail works even before GitHub is updated or when offline.
- `scraper.json` loads from GitHub first, bundle fallback second.
- Retry URL resolution if the background index is not ready yet.
- Removed optional site-permission prompts; universal manifest match grants host access.
- Proton Mail scraper: fixed message-view detection (`pathSegmentAfter` with segment after folder).
- Removed obsolete `activity-injector.js` and `runner.js`.

**After updating:** reload the extension, then refresh `mail.proton.me`.

---

### 1.0.17

**Universal remote activity host (initial)**

- Added `universal.js` content script on `http://*/*` and `https://*/*`.
- Bundled activities (YouTube, Reddit, Netflix) still use manifest `content_scripts`.
- Background `activity:resolveForUrl` for remote activity matching.

---

### 1.0.16

**Hotfix: bundled activities work again**

- Restored manifest `content_scripts` for YouTube, YouTube Music, Reddit, and Netflix. Firefox does not reliably run bundled scrapers via programmatic `executeScript`.
- Dynamic injector now handles **remote-only** activities (e.g. Proton Mail `scraper.json`).
- Site access prompts only appear for remote activities, not bundled ones.

**After updating:** refresh any open YouTube/Netflix/Reddit tabs once (or reload the extension and revisit the page).

---

### 1.0.15

**Hotfix: site permission prompts**

- `permissions.request()` is now called synchronously on button click. Awaiting other checks first dropped the user gesture and Firefox silently denied access.
- **Grant access** per activity and top **Grant access** banner now show Firefox's permission dialog.
- Falls back to `<all_urls>` if per-site request fails.
- Permission checks recognize a granted `<all_urls>` optional permission.

---

### 1.0.14

**Hotfix for dynamic loader**

- Scan all open tabs when the extension loads (reload, browser start, install). Previously scrapers never injected until a tab was refreshed.
- Popup prompts for missing site access on open (one-time migration from manifest `content_scripts`).
- Clear injection cache on resync so permission grants take effect immediately.
- Per-origin permission checks (fixes Reddit needing both `www` and `old` origins).

---

### 1.0.13

**Shipped with:** host v1.0.8+

**Major change: dynamic activity loader**

- Removed per-site `content_scripts` from `manifest.json`.
- Site access requested at runtime when the user enables an activity (`optional_permissions` + `browser.permissions.request`).
- Background `activity-injector.js` injects scrapers on matching tabs.
- **Remote activities:** `scraper.json` on GitHub + declarative engine (`activities/_runtime/runner.js`). No new AMO for simple new sites.
- **Bundled activities:** existing `content-script.js` files injected dynamically (YouTube, Reddit, Netflix, YouTube Music).
- Proton Mail migrated to remote `scraper.json` (`"scraper": "remote"`).
- Popup shows **Allow access** when an enabled activity lacks site permission.

**Migration:** users upgrading from 1.0.12 must re-allow site access per activity in the popup.

See [`docs/scraper-schema.md`](scraper-schema.md) for remote activity authoring.

---

### 1.0.12

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

Since **Scraper Engine v2** (extension 1.0.20, engine 2.0.0), all activities use remote `scraper.json`. New activities do not require a new XPI.

| Activity | Min engine | Scraper | Notes |
|---|---|---|---|
| YouTube Music | 2.0.0 | `scraper.json` v2 | Migrated in 1.0.20 |
| YouTube | 2.0.0 | `scraper.json` v2 | Migrated in 1.0.20 |
| Reddit | 2.0.0 | `scraper.json` v2 | Migrated in 1.0.20 |
| Netflix | 2.0.0 | `scraper.json` v2 | Migrated in 1.0.20 |
| Proton Mail | 2.0.0 | `scraper.json` v2 | Remote since 1.0.13; v2 rules in 1.0.22 |

**Extension version** (XPI) and **engine version** (`engine-version.json`) are separate. Settings → About shows both.

Users need extension **1.0.20+** once. After that, activity rule changes ship via GitHub only.

---

## Checking the installed extension version

**Users:** Firefox → Add-ons → Syncr, or Syncr popup → Settings → About (**Version** + **Scraper engine**).

**Repo source of truth:**

```text
extension/manifest.json          # extension version (1.0.x)
extension/engine-version.json    # scraper engine version (2.0.0)
```
