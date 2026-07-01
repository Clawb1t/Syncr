# Activities: authoring, review, and release

This guide is for **contributors** who want to add or improve a Syncr activity, and for **maintainers** who review, merge, and ship changes to users.

For low-level code flow, see [`architecture.md`](architecture.md). For SDK API details, see [`native-host/ACTIVITY_SDK.md`](../native-host/ACTIVITY_SDK.md).

---

## What is an activity?

An activity is a site integration (e.g. Reddit, Proton Mail). It has two parts:

| Part | Location | Runs in | Ships via |
|---|---|---|---|
| **Scraper** | `extension/activities/{id}/content-script.js` | Firefox on matching URLs | Signed extension `.xpi` |
| **Presence formatter** | `native-host/activities/{id}/presence.js` | `syncr-host.exe` | GitHub `main` (hot-update) or new host exe |

Plus UI metadata and branding:

- `extension/activities/{id}/metadata.json`
- `extension/activities/{id}/logo.png` or `logo.svg`
- Registry entry in `extension/activities/registry.json`
- Manifest entry in `extension/manifest.json`

---

## Contributor: before you code

1. **Open an issue** (recommended) describing the site, what should appear on Discord, and privacy considerations.
2. **Pick an activity ID**: lowercase slug, e.g. `reddit`, `proton-mail`. Must match folder names and exports.
3. **Create a Discord application** at [discord.com/developers](https://discord.com/developers/applications) named after the service (e.g. "Reddit"). Copy the **Application ID** for `clientId` in `presence.js`.
4. **Upload Rich Presence assets** under **Rich Presence → Art Assets** (not Activities → Art Assets). Keys must match `presence.js` (e.g. `reddit_logo`, `reading`).
5. **Fork** the repo and branch from `main`.

You do **not** need AMO signing keys or GitHub release tokens to contribute.

---

## Contributor: files to add

### 1. `extension/activities/{id}/metadata.json`

Describes the activity in the popup.

```json
{
  "id": "my-site",
  "name": "My Site",
  "description": "Short description for the activity list",
  "category": "Social",
  "icon": "🌐",
  "logo": "logo.png",
  "version": "1.0.0",
  "author": "Your Name",
  "urlPattern": "*://example.com/*",
  "buttonLabel": "Open site",
  "activityType": "WATCHING",
  "minExtensionVersion": "1.0.12"
}
```

Set `minExtensionVersion` to the **first extension release** that includes your content script. The popup uses this to lock the toggle until users update.

### 2. `extension/activities/{id}/content-script.js`

Scrapes the page and sends updates to the background script.

**Required pattern:**

```javascript
(function () {
  'use strict';
  const ACTIVITY_ID = 'my-site';
  const POLL_MS = 2000;
  let lastSent = null;

  function scrape() {
    // Return data object, { browsing: true }, or null if not ready
  }

  function poll() {
    const data = scrape();
    // Diff against lastSent; send only on meaningful changes
    browser.runtime.sendMessage({
      type: 'activity:update',
      activityId: ACTIVITY_ID,
      data,
    }).catch(() => {});
  }

  setInterval(poll, POLL_MS);
  window.addEventListener('popstate', () => { lastSent = null; poll(); });
  window.addEventListener('unload', () => {
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  });
  poll();
})();
```

**Rules:**

- Poll every ~2s; do not send duplicate data.
- Handle SPA navigation (`popstate`, `hashchange`, site-specific events).
- Clear on `unload`.
- Never scrape secrets, passwords, or private message bodies unless the PR explicitly documents it and maintainers approve.

### 3. `native-host/activities/{id}/presence.js`

Maps scraped `data` to Discord presence using the Syncr SDK.

```javascript
module.exports = {
  id:         'my-site',
  name:       'My Site',
  clientId:   'YOUR_DISCORD_APPLICATION_ID',
  urlPattern: '*://example.com/*',

  formatPresence(data, syncr) {
    if (data.browsing) {
      return syncr.browsing({
        type: syncr.ActivityType.Watching,
        name: 'My Site',
        logo: 'my_site_logo',
      });
    }
    return syncr.presence()
      .watching(data.title)
      .details(data.subtitle)
      .largeImage('my_site_logo')
      .button('Open', data.pageUrl)
      .build();
  },
};
```

Copy from [`native-host/activities/_template/presence.js`](../native-host/activities/_template/presence.js), YouTube, Reddit, or Proton Mail.

### 4. Registry and manifest

**`extension/activities/registry.json`:** add your ID to the `activities` array.

**`extension/manifest.json`:** add a `content_scripts` entry:

```json
{
  "matches": ["*://example.com/*"],
  "js": ["activities/my-site/content-script.js"],
  "run_at": "document_idle"
}
```

Bump `manifest.json` `version` for any extension change (maintainer does this at release if you forget).

---

## Case study: Reddit (full integration)

Reddit is the reference for browsing mode + rich detail pages.

### Scraping strategy

| Page type | Detection | Data sent |
|---|---|---|
| Post | URL `/r/.../comments/...` | `title`, `author`, `subreddit`, `score`, `comments`, `thumbnailUrl`, URLs |
| Feed / subreddit / profile | Everything else on `/u/` paths | `{ browsing: true, browsingContext: "r/foo" }` |

New Reddit uses **`shreddit-post` HTML attributes** (`post-title`, `author`, `score`, etc.). Old Reddit uses classic DOM selectors. Both are supported in one content script.

### Presence strategy

- **Browsing:** `syncr.browsing()` with `"Browsing r/subreddit"` or `"Browsing Reddit"`.
- **Post:** `.watching(title)` with details `r/sub · u/author`, state with score and comment count, thumbnail, buttons for post and subreddit.

### Discord setup

- Application ID in `presence.js` as `clientId`.
- Assets: `reddit_logo` (large), `reading` (small).

See [`extension/activities/reddit/`](../extension/activities/reddit/) and [`native-host/activities/reddit/`](../native-host/activities/reddit/) in the repo.

---

## Case study: Proton Mail (privacy-first)

Proton Mail only exposes **generic labels**:

- `"Drafting an email"`
- `"Viewing an email"`
- `"Browsing inbox"` / `"Browsing emails"`

The content script detects compose UI, message view layout, and URL/hash patterns. It **never** reads subjects, senders, or body text.

Use this pattern for email, banking, health, or messaging sites.

See [`extension/activities/proton-mail/`](../extension/activities/proton-mail/).

---

## Contributor: local testing

1. **Extension:** Firefox → `about:debugging` → Load Temporary Add-on → select `extension/manifest.json`.
2. **Host:** Install via Syncr Setup, or build locally:
   ```powershell
   cd native-host
   npm install
   npm run build
   ```
   Copy `dist/syncr-host.exe` to `%LOCALAPPDATA%\Syncr\` (or run Setup).
3. For **presence-only** edits, copy your `presence.js` to `%LOCALAPPDATA%\Syncr\activities\{id}\presence.js` and reconnect the host (popup Reconnect).
4. Open the target site, enable the activity in the popup, confirm Discord updates.
5. Test navigation: SPA route changes, back button, tab close, multiple activities at once.

---

## Contributor: opening a pull request

Include in the PR description:

- [ ] Activity ID and target URLs
- [ ] What appears on Discord (screenshot)
- [ ] Privacy: list every field scraped and shown
- [ ] Discord Application ID used for testing
- [ ] Rich Presence asset keys you uploaded
- [ ] Manual test steps you ran
- [ ] Whether an extension version bump is required (always yes for new content scripts)

---

## Maintainer: review checklist

### Code review

- [ ] Activity ID consistent across all files (`metadata.json`, `presence.js`, registry, manifest, `ACTIVITY_ID` in content script).
- [ ] Content script does not over-scrape or leak sensitive data.
- [ ] `poll()` avoids spam; handles SPA navigation.
- [ ] `presence.js` uses SDK; strings fit Discord limits (128 chars for details/state/name).
- [ ] Buttons use `https://` URLs only (max 2 buttons).
- [ ] `minExtensionVersion` set correctly in metadata.
- [ ] Logo present and referenced in metadata.

### Discord review

- [ ] Official Discord application created (or contributor's test app replaced with maintainer's production `clientId`).
- [ ] Rich Presence assets uploaded under **Rich Presence → Art Assets**.
- [ ] Asset keys in portal match `presence.js`.

### Functional review

- [ ] Test with temporary extension load + installed host.
- [ ] Toggle on/off in popup works.
- [ ] Multi-activity priority behaves correctly if overlapping with YouTube etc.
- [ ] Updates panel shows activity as installed/up to date after merge.

---

## Maintainer: release process

Releases are driven by [`update.ps1`](../update.ps1). You need `.env` with AMO JWT credentials and optionally `GITHUB_TOKEN`.

### Decision tree

```
Did the PR change extension/ (content script, manifest, popup)?
├── YES → Full release (bump extension manifest version)
└── NO  → Host-only possible if only presence.js / host core changed
```

### Full release (new or changed content scripts)

1. Merge PR to `main`.
2. Bump `extension/manifest.json` version (e.g. `1.0.11` → `1.0.12`).
3. If host core or SDK changed, bump `native-host/version.json` too.
4. Run:
   ```powershell
   .\update.ps1
   ```
5. Script will:
   - Sign extension via AMO (may wait for review)
   - Build `syncr-host.exe` and Syncr Setup
   - Update `updates.json` with XPI hash
   - Commit, tag `v{version}`, push, upload GitHub Release assets
6. Verify on GitHub Releases: `syncr.xpi`, `syncr-host.exe`, `Syncr-Setup-{version}.exe`.

### Host-only release (`presence.js` or host bugfix, no extension change)

1. Merge to `main`.
2. Bump `native-host/version.json` only if host **binary** changed (SDK, `host.js`, etc.).
3. For **presence.js only**, no host version bump is strictly required (hot-updater uses content hash), but bumping version helps users see "update available" in the popup.
4. Run:
   ```powershell
   .\update.ps1 -HostOnly
   ```
   Or full `update.ps1` if you also need a new extension release.

### After release: what users get

| Change | User experience |
|---|---|
| New `presence.js` on `main` | Popup **Check for updates** downloads it; or auto on next host start |
| New extension on AMO + `updates.json` | Firefox auto-updates extension (or manual XPI from Releases) |
| New `syncr-host.exe` | Updates panel shows host update; download Setup or exe |

Users do **not** need full Setup reinstall for presence-only activity updates.

---

## Maintainer: swapping Discord Application IDs

Contributors often test with their own Discord app. Before release:

1. Create (or use) the official application under the maintainer's Discord account.
2. Upload production art assets.
3. Replace `clientId` in `native-host/activities/{id}/presence.js`.
4. Push to `main` (hot-update delivers to users) or include in next host release.

---

## Maintainer: adding an activity without a contributor PR

Follow the same file checklist as contributors. Reddit was added by:

1. Creating extension scraper + metadata + logo.
2. Creating `presence.js` with production `clientId`.
3. Updating `registry.json` and `manifest.json`.
4. Bumping extension to `1.0.9` and host to `1.0.6`.
5. Running `.\update.ps1` to publish.

---

## Quick reference

| Task | Command / location |
|---|---|
| SDK docs | `native-host/ACTIVITY_SDK.md` |
| Presence template | `native-host/activities/_template/presence.js` |
| Architecture | `docs/architecture.md` |
| Host versions | `docs/host-changelog.md` |
| Full publish | `.\update.ps1` |
| Host-only publish | `.\update.ps1 -HostOnly` |
| Build only (no git) | `.\update.ps1 -BuildOnly` |
| Installed host path | `%LOCALAPPDATA%\Syncr\` |
| Host log | `%LOCALAPPDATA%\Syncr\host.log` |
