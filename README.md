# Syncr

**Discord Rich Presence for Firefox.** Syncr shows what you're doing on the web, right on your Discord profile.

Browse YouTube, listen on YouTube Music, scroll Reddit, check your mail, and your friends see it in Discord, the same way a desktop app would. No Discord login required. No cloud servers. Everything stays on your PC.

---

## What it does

Syncr reads activity from sites you visit in Firefox and sends it to the Discord desktop app. Your profile updates in real time with titles, artwork, progress bars, and quick links back to what you're doing.

Open the Syncr popup to see what's currently being transmitted, search through available activities, and turn individual sites on or off. Only the activities you enable will show up on Discord.

---

## Supported activities

| Activity | What shows on Discord |
|---|---|
| **YouTube Music** | Listening status with song title, artist, album art, and a progress bar |
| **YouTube** | Watching status with video title and channel |
| **Reddit** | Post titles, subreddits, scores, and browsing context, or a general browsing status on feeds and profiles |
| **Proton Mail** | A generic "checking mail" status with no subjects, senders, or personal content |

New activities are added over time. The popup picks them up automatically from GitHub. Host-side presence files hot-update without a full reinstall; new content scripts require an extension update.

---

## Privacy

Syncr is built to stay local:

- **No Discord account login:** Syncr talks directly to the Discord desktop app on your machine
- **No cloud backend:** page data goes from Firefox → a small local app → Discord. Nothing is sent to a Syncr server
- **You choose what to share:** disable any activity you don't want on your profile
- **Privacy-conscious activities:** some integrations (like Proton Mail) are deliberately generic and never expose sensitive details

---

## Requirements

- **Firefox** with the Syncr extension
- **Discord desktop app** (not the browser version)
- **Windows** (current platform)

---

## How Syncr works

Syncr is split into two layers. Both are required for an activity to work end-to-end.

```
Firefox tab
    │
    ▼
content-script.js          scrapes the page (runs in the site)
    │
    ▼
background.js              picks which activity transmits, forwards to host
    │
    ▼
syncr-host.exe             formats Discord presence (native messaging)
    │
    ▼
Discord desktop            Rich Presence on your profile
```

| Layer | Location | What it does |
|---|---|---|
| **Extension** | `extension/activities/{id}/` | Injects a content script on matching URLs, scrapes page data, sends `{ activityId, data }` to the background script |
| **Native host** | `native-host/activities/{id}/presence.js` | Receives scraped data, maps it to a Discord activity via the Syncr SDK, sends it over Discord IPC |

The popup loads the activity list from `extension/activities/registry.json` on GitHub (merged with whatever is bundled in the installed extension). The host hot-updates `presence.js` files from GitHub when users click **Check for updates**.

### Project layout

```
Syncr/
├── extension/
│   ├── manifest.json                 # content_scripts entries per activity
│   ├── background/background.js      # native messaging + multi-activity priority
│   ├── popup/                        # activity list, toggles, updates UI
│   └── activities/
│       ├── registry.json             # list of activity IDs
│       └── {id}/
│           ├── metadata.json         # name, description, logo, minExtensionVersion
│           ├── content-script.js     # page scraper
│           └── logo.svg / logo.png
├── native-host/
│   ├── host.js                       # native messaging router
│   ├── activity-loader.js            # loads presence.js modules
│   ├── updater.js                    # hot-updates activities from GitHub
│   ├── sdk/                          # Discord presence builder (bundled in exe)
│   └── activities/
│       └── {id}/presence.js          # Discord formatting + clientId
└── launcher/                         # Syncr Setup installer
```

---

## Contributing

Contributions are welcome — especially new activities. Open an issue to discuss an idea, or open a pull request with a working activity.

### What you can contribute

| Type | Files touched | Ships to users via |
|---|---|---|
| **New activity** | `extension/activities/{id}/`, `native-host/activities/{id}/`, `registry.json`, `manifest.json` | Extension `.xpi` + host `presence.js` |
| **Presence tweaks only** | `native-host/activities/{id}/presence.js` | Host hot-update (no extension reinstall) |
| **Popup / host core** | `extension/popup/`, `native-host/host.js`, etc. | Full release (maintainer) |

### Before you start

1. **Fork** the repo and create a branch.
2. **Pick an activity ID** — lowercase slug, e.g. `reddit`, `proton-mail`.
3. **Create a Discord application** at [discord.com/developers](https://discord.com/developers/applications) for your activity (one app per site). Copy the **Application ID** — you'll put it in `presence.js` as `clientId`. You can use your own app for testing; the maintainer may use an official app ID on release.
4. **Upload Rich Presence art assets** under **Rich Presence → Art Assets** (not Activities → Art Assets). Asset keys must match what you reference in `presence.js` (e.g. `reddit_logo`).

See [`native-host/ACTIVITY_SDK.md`](native-host/ACTIVITY_SDK.md) for the full presence API and [`native-host/activities/_template/presence.js`](native-host/activities/_template/presence.js) for a starter template.

### Adding a new activity — checklist

- [ ] `extension/activities/{id}/metadata.json`
- [ ] `extension/activities/{id}/content-script.js`
- [ ] `extension/activities/{id}/logo.svg` or `logo.png`
- [ ] `native-host/activities/{id}/presence.js` (with `clientId`)
- [ ] Add `"{id}"` to `extension/activities/registry.json`
- [ ] Add a `content_scripts` block to `extension/manifest.json`
- [ ] Set `minExtensionVersion` in `metadata.json` to the version that first ships your content script
- [ ] Test on the real site (SPA navigation, pause/play if media, browsing vs detail views)
- [ ] Document privacy implications in the PR (what data is scraped and shown on Discord)

### Content script pattern

Every content script follows the same structure:

1. **Constants** — `ACTIVITY_ID`, `POLL_MS` (typically 2000)
2. **`scrape()`** — read the DOM / URL; return a data object or `{ browsing: true }`
3. **`poll()`** — call `scrape()`, diff against `lastSent`, only send when something meaningful changed
4. **Messages** — `browser.runtime.sendMessage({ type: 'activity:update', activityId, data })` or `activity:clear`
5. **Lifecycle** — `setInterval(poll)`, reset on SPA navigation (`popstate`, `hashchange`, site-specific events), clear on `unload`

Do not spam Discord — only send updates when title, mode, or other tracked fields change.

### Privacy guidelines

- **Default to the minimum** — only scrape fields you need for presence text/images.
- **Sensitive sites** (email, banking, health, DMs): use generic labels only, like Proton Mail does (`"Viewing an email"`, never subjects or senders).
- **Never** send passwords, tokens, or private message bodies.
- Call out in your PR exactly what appears on Discord.

---

## Case study: the Reddit activity

Reddit is a good reference for a full integration with browsing mode, rich post details, and SPA navigation.

### Files added

| File | Purpose |
|---|---|
| `extension/activities/reddit/metadata.json` | Popup listing: name, icon, category, `minExtensionVersion` |
| `extension/activities/reddit/content-script.js` | Scrapes Reddit pages |
| `extension/activities/reddit/logo.png` | Logo in the popup |
| `native-host/activities/reddit/presence.js` | Formats Discord presence |
| `extension/activities/registry.json` | Added `"reddit"` |
| `extension/manifest.json` | Content script for `www.reddit.com` and `old.reddit.com` |

### Step 1 — metadata.json

Describes the activity for the popup and documents the minimum extension version:

```json
{
  "id": "reddit",
  "name": "Reddit",
  "description": "Tracks posts and browsing on reddit.com",
  "category": "Social",
  "urlPattern": "*://www.reddit.com/*",
  "activityType": "WATCHING",
  "minExtensionVersion": "1.0.9"
}
```

### Step 2 — content-script.js (scraping)

Reddit has two UIs (new Reddit with `shreddit-post` web components, and old Reddit). The scraper branches on that, then decides the **mode**:

| Page | Data sent |
|---|---|
| Post (`/r/.../comments/...`) | `title`, `author`, `subreddit`, `score`, `comments`, `postType`, `thumbnailUrl`, URLs |
| Feed / subreddit / profile / search | `{ browsing: true, browsingContext: "r/programming" }` etc. |

On new Reddit, post metadata comes from **`shreddit-post` HTML attributes** (`post-title`, `author`, `score`, `comment-count`, …) — no fragile nested div scraping. Thumbnails use post attributes or `og:image`.

The poll loop only sends when `title`, `author`, `subreddit`, `score`, or `comments` change, or when switching between browsing and post mode. URL changes reset state via `popstate` and by comparing `location.href` each tick.

### Step 3 — presence.js (Discord)

The host receives the scraped `data` object and builds presence with the Syncr SDK:

- **Browsing** → `syncr.browsing()` with `"Browsing r/foo"` or `"Browsing Reddit"`
- **Post** → `.watching(title)` with details `r/subreddit · u/author`, state `↑ score · N comments`, thumbnail, two buttons (post + subreddit)

Each activity needs its own Discord **Application ID** (`clientId`). Reddit uses a dedicated app — the presence shows as "Reddit" on your profile, not "Syncr".

Rich Presence assets (under **Rich Presence → Art Assets**, not Activities):

| Asset key | Used for |
|---|---|
| `reddit_logo` | Large image fallback |
| `reading` | Small status icon |

### Step 4 — wire it up

**registry.json** — add the ID:

```json
{ "activities": ["youtube-music", "youtube", "reddit"] }
```

**manifest.json** — register the content script:

```json
{
  "matches": ["*://www.reddit.com/*", "*://old.reddit.com/*"],
  "js": ["activities/reddit/content-script.js"],
  "run_at": "document_idle"
}
```

### What users see on Discord

| On Reddit | Discord presence |
|---|---|
| Home feed | Watching **Reddit** — *Browsing Reddit* |
| `r/programming` | Watching **Reddit** — *Browsing r/programming* |
| A post | Watching **Post title** — *r/sub · u/author* — ↑ 1.2k · 42 comments |

---

## Pull requests

1. Fork → branch → implement (use Reddit or Proton Mail as references).
2. Test manually: enable the activity in the popup, confirm Discord updates, navigate around the site (SPA routes, back button).
3. Open a PR describing:
   - What site/activity you added or changed
   - What appears on Discord (screenshot helps)
   - Privacy notes — what is and isn't scraped
   - Discord Application ID used for testing (maintainer may swap for the official app)
4. A maintainer reviews, merges, and publishes a release.

You do **not** need AMO signing credentials or GitHub release tokens to contribute — maintainers handle publishing via `update.ps1`.

### Local development (contributors)

1. Load the extension temporarily in Firefox via `about:debugging` → **Load Temporary Add-on** → pick `extension/manifest.json`.
2. Install/run the native host via **Syncr Setup** or build `native-host` with `npm run build`.
3. Enable your activity in the popup and visit the target site.

For presence-only changes, you can edit `native-host/activities/{id}/presence.js` locally and restart the host — no extension rebuild needed.

---

## Publishing (maintainers)

Releases are handled by `update.ps1` (requires `.env` with AMO + GitHub credentials):

```powershell
# Bump extension/manifest.json version, then:
.\update.ps1
```

- **Extension changes** (new content scripts) → signed `.xpi` on GitHub Releases + `updates.json`
- **Host `presence.js` only** → `.\update.ps1 -HostOnly` after bumping `native-host/version.json`

Users get host activity updates through **Check for updates** in the popup without reinstalling Syncr Setup.

---

## Further reading

- [`native-host/ACTIVITY_SDK.md`](native-host/ACTIVITY_SDK.md) — presence builder API, field limits, Discord setup
- [`native-host/activities/_template/presence.js`](native-host/activities/_template/presence.js) — copy-paste presence starter
- [`extension/activities/reddit/`](extension/activities/reddit/) — full Reddit content script example
- [`extension/activities/proton-mail/`](extension/activities/proton-mail/) — privacy-first generic activity example

---

## Open source

Syncr is open source. Issues, activity ideas, and pull requests are welcome on [GitHub](https://github.com/Clawb1t/Syncr).
