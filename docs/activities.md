# Activities: authoring, review, and release

This guide is for **contributors** who want to add or improve a Syncr activity, and for **maintainers** who review, merge, and ship changes to users.

For low-level code flow, see [`architecture.md`](architecture.md). For scraper rule syntax, see [`scraper-schema.md`](scraper-schema.md) and [`scraper-engine-v2-spec.md`](scraper-engine-v2-spec.md). For SDK API details, see [`native-host/ACTIVITY_SDK.md`](../native-host/ACTIVITY_SDK.md).

---

## What is an activity?

An activity is a site integration (e.g. Reddit, Proton Mail). Since **Scraper Engine v2** (extension 1.0.20+, engine 2.0.0), every activity has two parts:

| Part | Location | Runs in | Ships via |
|---|---|---|---|
| **Scraper rules** | `extension/activities/{id}/scraper.json` | Firefox (declarative engine) | GitHub `main` — **no new XPI** |
| **Presence formatter** | `native-host/activities/{id}/presence.js` | `syncr-host.exe` | GitHub `main` (hot-update) |

Plus UI metadata and branding:

- `extension/activities/{id}/metadata.json` — popup listing, URL origins, `minEngineVersion`
- `extension/activities/{id}/logo.png` or `logo.svg` (optional but recommended)
- Registry entry in `extension/activities/registry.json`

The extension ships **one universal content script** on all `http(s)://` pages. It resolves the current URL against the activity index, loads `scraper.json`, and runs rules through the fixed engine in the XPI. **No per-site manifest entries. No `content-script.js`.**

---

## What needs a new XPI?

| Change | New XPI? |
|---|---|
| New activity (`metadata.json` + `scraper.json` + `presence.js` on GitHub) | **No** |
| Fix or improve rules in `scraper.json` | **No** |
| New `presence.js` formatting | **No** (host hot-update) |
| New engine primitive (helper, extractor type) | **Yes** |
| Engine bugfix or Firefox manifest change | **Yes** |

Users need extension **1.0.20+** once (engine 2.0.0). After that, new activities are GitHub-only unless the site needs something the DSL cannot express yet.

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

Describes the activity in the popup and tells the background script which URLs to match.

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
  "urlPattern": "*://www.example.com/*",
  "origins": ["*://www.example.com/*", "*://old.example.com/*"],
  "scraper": "remote",
  "minEngineVersion": "2.0.0",
  "buttonLabel": "Open site",
  "activityType": "WATCHING"
}
```

| Field | Required | Purpose |
|---|---|---|
| `origins` | Yes | URL patterns for activity resolution (include bare host if needed, e.g. `*://mail.proton.me`) |
| `scraper` | Yes | Must be `"remote"` |
| `minEngineVersion` | Yes | Minimum scraper engine version (`extension/engine-version.json`) |
| `fetchOrigins` | If using `fetchJson` | Allowlist of origins the scraper may fetch |

Set `minEngineVersion` to the **lowest engine version** your `scraper.json` requires. The popup locks the toggle until the installed extension meets that engine version.

### 2. `extension/activities/{id}/scraper.json`

Declarative rules interpreted by Scraper Engine v2. See [`scraper-schema.md`](scraper-schema.md) for the full DSL.

Minimal example (URL-only, like Proton Mail):

```json
{
  "version": 2,
  "pollMs": 2000,
  "changeDetection": { "compareFields": ["mode", "context"] },
  "rules": [
    {
      "when": { "pathIncludes": "/compose" },
      "emit": { "mode": "drafting", "context": "Drafting", "pageUrl": "{url}" }
    }
  ],
  "default": {
    "emit": { "mode": "browsing", "context": "Browsing", "pageUrl": "{url}" }
  }
}
```

Rich example (DOM extraction, like Reddit posts):

```json
{
  "version": 2,
  "pollMs": 2000,
  "profiles": [
    {
      "id": "new-ui",
      "when": { "selectorExists": ["shreddit-post"] },
      "rules": [
        {
          "when": { "pathIncludes": "/comments/" },
          "extract": {
            "title": { "selectorAttr": { "selector": "shreddit-post", "attr": "post-title" } }
          },
          "require": ["title"],
          "emit": { "title": "{title}", "pageUrl": "{url}" }
        }
      ]
    }
  ],
  "default": { "emit": { "browsing": true, "browsingContext": "Browsing" } }
}
```

**Rules:**

- Use `"version": 2` for all new activities.
- Wrap output in `"emit"` blocks; use `"default": { "emit": { ... } }` for fallbacks.
- Add `changeDetection` to avoid spamming Discord on unchanged polls.
- Never scrape secrets, passwords, or private message bodies unless the PR explicitly documents it and maintainers approve.
- Validate locally: `bun run validate:scrapers` and `bun run test:engine`.

### 3. `native-host/activities/{id}/presence.js`

Maps scraped `data` to Discord presence using the Syncr SDK.

```javascript
module.exports = {
  id:         'my-site',
  name:       'My Site',
  clientId:   'YOUR_DISCORD_APPLICATION_ID',
  urlPattern: '*://www.example.com/*',

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

### 4. Registry

**`extension/activities/registry.json`:** add your ID to the `activities` array:

```json
{ "activities": ["youtube-music", "youtube", "reddit", "proton-mail", "netflix", "my-site"] }
```

Push to `main`. The popup and background script fetch this from GitHub and merge it with the bundled copy in the installed extension.

**Do not** add per-site entries to `extension/manifest.json`. **Do not** bump the extension version for a new activity unless you changed the engine itself.

---

## Case study: Reddit (full integration)

Reddit uses **profiles** for new vs old Reddit, **extractors** for post metadata, and **helpers** for URL/thumbnail cleanup.

| Page type | Scraper approach | Data sent |
|---|---|---|
| Post | `pathIncludes: "/comments/"` + `shreddit-post` attributes / old Reddit selectors | `title`, `author`, `subreddit`, `score`, `comments`, `thumbnailUrl`, URLs |
| Feed / subreddit / profile | `default` emit | `{ browsing: true, browsingContext: "r/foo" }` |

See [`extension/activities/reddit/scraper.json`](../extension/activities/reddit/scraper.json) and [`native-host/activities/reddit/presence.js`](../native-host/activities/reddit/presence.js).

### Presence strategy

- **Browsing:** `syncr.browsing()` with `"Browsing r/subreddit"` or `"Browsing Reddit"`.
- **Post:** `.watching(title)` with details `r/sub · u/author`, state with score and comment count, thumbnail, buttons for post and subreddit.

### Discord setup

- Application ID in `presence.js` as `clientId`.
- Assets: `reddit_logo` (large), `reading` (small).

---

## Case study: Proton Mail (privacy-first)

Proton Mail only exposes **generic labels** via URL and DOM-presence rules:

- `"Drafting an email"`
- `"Viewing an email"`
- `"Browsing inbox"` / `"Browsing emails"`

The scraper **never** reads subjects, senders, or body text. Use this pattern for email, banking, health, or messaging sites.

See [`extension/activities/proton-mail/scraper.json`](../extension/activities/proton-mail/scraper.json).

---

## Contributor: local testing

1. **Extension:** Firefox → `about:debugging` → Load Temporary Add-on → select `extension/manifest.json`. Requires **1.0.20+** (engine 2.0.0).
2. **Host:** Install via Syncr Setup, or build locally:
   ```powershell
   cd native-host
   bun install
   bun run build
   ```
   Copy `dist/syncr-host.exe` to `%LOCALAPPDATA%\Syncr\` (or run Setup).
3. For **presence-only** edits, copy your `presence.js` to `%LOCALAPPDATA%\Syncr\activities\{id}\presence.js` and reconnect the host (popup Reconnect).
4. For **scraper.json** edits, save the file locally under `extension/activities/{id}/` and reload the target tab (the universal host loads bundled `scraper.json` first, then GitHub).
5. Open the target site, enable the activity in the popup, confirm Discord updates.
6. Test navigation: SPA route changes, back button, tab close, multiple activities at once.

```powershell
bun run validate:scrapers
bun run test:engine
```

---

## Contributor: opening a pull request

Include in the PR description:

- [ ] Activity ID and target URLs (`origins` in metadata)
- [ ] What appears on Discord (screenshot)
- [ ] Privacy: list every field scraped and shown
- [ ] Discord Application ID used for testing
- [ ] Rich Presence asset keys you uploaded
- [ ] Manual test steps you ran
- [ ] Whether a **new XPI** is required (should be **no** for standard scraper + presence-only activities)

---

## Maintainer: review checklist

### Code review

- [ ] Activity ID consistent across all files (`metadata.json`, `presence.js`, `registry.json`).
- [ ] `metadata.json` has `scraper: "remote"`, `origins`, and `minEngineVersion`.
- [ ] `scraper.json` validates (`bun run validate:scrapers`).
- [ ] Scraper does not over-scrape or leak sensitive data.
- [ ] `changeDetection` present where polling would otherwise spam updates.
- [ ] `presence.js` uses SDK; strings fit Discord limits (128 chars for details/state/name).
- [ ] Buttons use `https://` URLs only (max 2 buttons).
- [ ] Logo present and referenced in metadata.

### Discord review

- [ ] Official Discord application created (or contributor's test app replaced with maintainer's production `clientId`).
- [ ] Rich Presence assets uploaded under **Rich Presence → Art Assets**.
- [ ] Asset keys in portal match `presence.js`.

### Functional review

- [ ] Test with temporary extension load (1.0.20+) + installed host.
- [ ] Toggle on/off in popup works.
- [ ] Multi-activity priority behaves correctly if overlapping with YouTube etc.
- [ ] Updates panel shows activity as installed/up to date after merge.

---

## Maintainer: release process

Releases are driven by [`update.ps1`](../update.ps1). You need `.env` with AMO JWT credentials and optionally `GITHUB_TOKEN`.

### Decision tree

```
Did the PR change the scraper engine or extension manifest/core?
├── YES → Full release (bump extension manifest version)
├── NO, only scraper.json / metadata / registry on GitHub → Push to main only (no XPI)
└── NO, only presence.js → Host hot-update (optional version bump for visibility)
```

### GitHub-only release (new or updated activity)

1. Merge PR to `main` with:
   - `extension/activities/{id}/metadata.json`
   - `extension/activities/{id}/scraper.json`
   - `native-host/activities/{id}/presence.js`
   - Updated `extension/activities/registry.json`
2. Users on extension **1.0.20+** get the new activity after:
   - Popup refresh (registry from GitHub)
   - **Check for updates** (downloads `presence.js` to the host)
3. **No AMO release required.**

### Full release (engine change, manifest change, popup/background fix)

1. Merge PR to `main`.
2. Bump `extension/manifest.json` version (e.g. `1.0.22` → `1.0.23`).
3. If host core or SDK changed, bump `native-host/version.json` too.
4. Run:
   ```powershell
   .\update.ps1
   ```
5. Script will sign the extension via AMO, build host/Setup, update `updates.json`, tag, and publish GitHub Release assets.

### Host-only release (`presence.js` or host bugfix, no extension change)

1. Merge to `main`.
2. Bump `native-host/version.json` only if host **binary** changed (SDK, `host.js`, etc.).
3. For **presence.js only**, no host version bump is strictly required (hot-updater uses content hash), but bumping version helps users see "update available" in the popup.
4. Run:
   ```powershell
   .\update.ps1 -HostOnly
   ```

### After release: what users get

| Change | User experience |
|---|---|
| New/updated `scraper.json` or `metadata.json` on `main` | Works on next tab load (extension 1.0.20+) |
| New `registry.json` entry on `main` | Popup picks up new activity on open |
| New `presence.js` on `main` | Popup **Check for updates** downloads it; or auto on next host start |
| New extension on AMO + `updates.json` | Firefox auto-updates extension (or manual XPI from Releases) |
| New `syncr-host.exe` | Updates panel shows host update; download Setup or exe |

Users do **not** need full Setup reinstall for scraper or presence-only activity updates.

---

## Maintainer: swapping Discord Application IDs

Contributors often test with their own Discord app. Before release:

1. Create (or use) the official application under the maintainer's Discord account.
2. Upload production art assets.
3. Replace `clientId` in `native-host/activities/{id}/presence.js`.
4. Push to `main` (hot-update delivers to users) or include in next host release.

---

## Maintainer: adding an activity without a contributor PR

1. Add `metadata.json`, `scraper.json`, and logo under `extension/activities/{id}/`.
2. Add `presence.js` under `native-host/activities/{id}/` with production `clientId`.
3. Add the ID to `extension/activities/registry.json`.
4. Push to `main`.
5. Run **Check for updates** locally to pull `presence.js` to the host.

**No manifest bump. No XPI.** Only ship a new extension if the site needs a new engine primitive.

---

## Quick reference

| Task | Command / location |
|---|---|
| Scraper schema | `docs/scraper-schema.md` |
| Engine v2 spec | `docs/scraper-engine-v2-spec.md` |
| SDK docs | `native-host/ACTIVITY_SDK.md` |
| Presence template | `native-host/activities/_template/presence.js` |
| Architecture | `docs/architecture.md` |
| Host versions | `docs/host-changelog.md` |
| Validate scrapers | `bun run validate:scrapers` |
| Test engine | `bun run test:engine` |
| Full publish | `.\update.ps1` |
| Host-only publish | `.\update.ps1 -HostOnly` |
| Build only (no git) | `.\update.ps1 -BuildOnly` |
| Installed host path | `%LOCALAPPDATA%\Syncr\` |
| Host log | `%LOCALAPPDATA%\Syncr\host.log` |
