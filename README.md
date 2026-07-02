# Syncr

**Discord Rich Presence for Firefox.** Syncr shows what you're doing on the web, right on your Discord profile.

Browse YouTube, listen on YouTube Music, scroll Reddit, check your mail, watch Netflix, and your friends see it in Discord, the same way a desktop app would. No Discord login required. No cloud servers. Everything stays on your PC.

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
| **Netflix** | Browsing and search status, title pages, and playback with season, episode, artwork, and a progress bar |
| **GitHub** | Repositories, issues, pull requests, files, profiles, gists, search, and more |

New activities are added over time. The popup picks them up automatically from GitHub. The extension ships the **scraper engine**; activity rules live in `scraper.json` on GitHub and hot-update without a new XPI. Host `presence.js` files hot-update via **Check for updates**.

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
universal.js + engine v2    resolves URL, runs scraper.json rules
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
| **Extension engine** | `extension/activities/_runtime/engine/` | Universal host + declarative scraper interpreter (ships in XPI) |
| **Activity rules** | `extension/activities/{id}/scraper.json` on GitHub | URL/DOM/fetch rules; hot-updates without a new XPI (engine v2.0.0+) |
| **Native host** | `native-host/activities/{id}/presence.js` | Maps scraped data to Discord presence via the Syncr SDK |

The popup loads the activity list from `extension/activities/registry.json` on GitHub (merged with whatever is bundled in the installed extension). The host hot-updates `presence.js` files from GitHub when users click **Check for updates**.

### Project layout

```
Syncr/
├── extension/
│   ├── manifest.json                 # single universal content_scripts entry
│   ├── engine-version.json           # scraper engine version (2.0.0)
│   ├── background/background.js      # native messaging + remote activity index
│   ├── popup/                        # activity list, toggles, updates UI
│   └── activities/
│       ├── registry.json             # list of activity IDs (also on GitHub)
│       ├── _runtime/
│       │   ├── universal.js          # URL resolve + poll loop
│       │   └── engine/               # Scraper Engine v2 (fixed DSL interpreter)
│       └── {id}/
│           ├── metadata.json         # name, origins, minEngineVersion
│           ├── scraper.json          # declarative scrape rules (hot-updates)
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

Contributions are welcome, especially new activities. Open an issue to discuss an idea, or open a pull request with a working activity.

### What you can contribute

| Type | Files touched | Ships to users via |
|---|---|---|
| **New activity** | `metadata.json`, `scraper.json`, `presence.js`, `registry.json` | GitHub `main` — **no new XPI** (engine 2.0.0+) |
| **Scraper fix** | `extension/activities/{id}/scraper.json` | GitHub `main` — no XPI |
| **Presence tweaks** | `native-host/activities/{id}/presence.js` | Host hot-update |
| **Engine / extension core** | `extension/activities/_runtime/engine/`, manifest, popup | Full release (maintainer) |

### Adding a new activity: checklist

- [ ] `extension/activities/{id}/metadata.json` (`scraper: "remote"`, `origins`, `minEngineVersion: "2.0.0"`)
- [ ] `extension/activities/{id}/scraper.json` (`"version": 2`)
- [ ] `extension/activities/{id}/logo.svg` or `logo.png`
- [ ] `native-host/activities/{id}/presence.js` (with `clientId`)
- [ ] Add `"{id}"` to `extension/activities/registry.json`
- [ ] Run `bun run validate:scrapers` and `bun run test:engine`
- [ ] Test on the real site (SPA navigation, pause/play if media, browsing vs detail views)
- [ ] Document privacy implications in the PR (what data is scraped and shown on Discord)

**Do not** add `content-script.js` or per-site `content_scripts` manifest entries. **Do not** bump the extension version unless you changed the engine.

### Scraper pattern (Scraper Engine v2)

Activities are declarative JSON, not hand-written poll loops:

1. **`when`** — match URL, selectors, hash params, or profiles (old vs new UI)
2. **`extract`** — read DOM text, attributes, video state, or `fetchJson` (optional)
3. **`emit`** — map extracted values into the payload sent to the host (`{title}`, `{url}`, …)
4. **`changeDetection`** — only send when meaningful fields change
5. **`default.emit`** — fallback when no rule matches

See [`docs/scraper-schema.md`](docs/scraper-schema.md) for the full DSL. Reddit, YouTube, Netflix, and Proton Mail are reference implementations.

### Before you start

1. **Fork** the repo and create a branch.
2. **Pick an activity ID**: lowercase slug, e.g. `reddit`, `proton-mail`.
3. **Create a Discord application** at [discord.com/developers](https://discord.com/developers/applications) for your activity (one app per site). Copy the **Application ID**; you'll put it in `presence.js` as `clientId`. You can use your own app for testing; the maintainer may use an official app ID on release.
4. **Upload Rich Presence art assets** under **Rich Presence → Art Assets** (not Activities → Art Assets). Asset keys must match what you reference in `presence.js` (e.g. `reddit_logo`).

See [`native-host/ACTIVITY_SDK.md`](native-host/ACTIVITY_SDK.md) for the full presence API, [`docs/scraper-schema.md`](docs/scraper-schema.md) for scraper rules, and [`native-host/activities/_template/presence.js`](native-host/activities/_template/presence.js) for a starter template.

### Privacy guidelines

- **Default to the minimum**: only scrape fields you need for presence text/images.
- **Sensitive sites** (email, banking, health, DMs): use generic labels only, like Proton Mail does (`"Viewing an email"`, never subjects or senders).
- **Never** send passwords, tokens, or private message bodies.
- Call out in your PR exactly what appears on Discord.

---

## Case study: the Reddit activity

Reddit is a good reference for a full Scraper Engine v2 integration: **profiles** for new vs old Reddit, **extractors** for post metadata, and **helpers** for URLs and thumbnails.

### Files added

| File | Purpose |
|---|---|
| `extension/activities/reddit/metadata.json` | Popup listing, `origins`, `minEngineVersion` |
| `extension/activities/reddit/scraper.json` | Declarative scrape rules |
| `extension/activities/reddit/logo.png` | Logo in the popup |
| `native-host/activities/reddit/presence.js` | Formats Discord presence |
| `extension/activities/registry.json` | Added `"reddit"` |

No `content-script.js`. No per-site manifest entry.

### Step 1: metadata.json

```json
{
  "id": "reddit",
  "name": "Reddit",
  "description": "Tracks posts and browsing on reddit.com",
  "category": "Social",
  "urlPattern": "*://www.reddit.com/*",
  "origins": ["*://www.reddit.com/*", "*://old.reddit.com/*"],
  "scraper": "remote",
  "minEngineVersion": "2.0.0",
  "activityType": "WATCHING"
}
```

### Step 2: scraper.json (scraping)

Reddit uses **profiles** to branch between new Reddit (`shreddit-post`) and old Reddit (classic selectors):

| Page | Scraper approach | Data sent |
|---|---|---|
| Post | `pathIncludes: "/comments/"` + extractors | `title`, `author`, `subreddit`, `score`, `comments`, `thumbnailUrl`, URLs |
| Feed / subreddit / profile | `default.emit` | `{ browsing: true, browsingContext: "r/programming" }` |

On new Reddit, post metadata comes from **`shreddit-post` HTML attributes** (`post-title`, `author`, `score`, …). `changeDetection` avoids spamming Discord on unchanged polls.

See [`extension/activities/reddit/scraper.json`](extension/activities/reddit/scraper.json) for the full file.

### Step 3: presence.js (Discord)

The host receives the scraped `data` object and builds presence with the Syncr SDK:

- **Browsing** → `syncr.browsing()` with `"Browsing r/foo"` or `"Browsing Reddit"`
- **Post** → `.watching(title)` with details `r/subreddit · u/author`, state `↑ score · N comments`, thumbnail, two buttons (post + subreddit)

Each activity needs its own Discord **Application ID** (`clientId`). Reddit uses a dedicated app, so the presence shows as "Reddit" on your profile, not "Syncr".

Rich Presence assets (under **Rich Presence → Art Assets**, not Activities):

| Asset key | Used for |
|---|---|
| `reddit_logo` | Large image fallback |
| `reading` | Small status icon |

### Step 4: wire it up

**registry.json**: add the ID:

```json
{ "activities": ["youtube-music", "youtube", "reddit", "proton-mail", "netflix"] }
```

Push to `main`. Users on extension **1.0.20+** get the activity from GitHub; **Check for updates** pulls `presence.js` to the host.

### What users see on Discord

| On Reddit | Discord presence |
|---|---|
| Home feed | Watching **Reddit**, *Browsing Reddit* |
| `r/programming` | Watching **Reddit**, *Browsing r/programming* |
| A post | Watching **Post title**, *r/sub · u/author*, ↑ 1.2k · 42 comments |

---

## Pull requests

1. Fork → branch → implement (use Reddit or Proton Mail as references).
2. Test manually: enable the activity in the popup, confirm Discord updates, navigate around the site (SPA routes, back button).
3. Run `bun run validate:scrapers` and `bun run test:engine`.
4. Open a PR describing:
   - What site/activity you added or changed
   - What appears on Discord (screenshot helps)
   - Privacy notes: what is and isn't scraped
   - Discord Application ID used for testing (maintainer may swap for the official app)
5. A maintainer reviews and merges. **New activities ship via GitHub only** — no XPI unless the engine changed.

You do **not** need AMO signing credentials or GitHub release tokens to contribute. Maintainers handle extension releases via `update.ps1` when the engine changes.

### Local development (contributors)

1. Load the extension temporarily in Firefox via `about:debugging` → **Load Temporary Add-on** → pick `extension/manifest.json` (needs **1.0.20+**).
2. Install/run the native host via **Syncr Setup** or build `native-host` with `bun run build`.
3. Enable your activity in the popup and visit the target site.

For **presence-only** changes, edit `native-host/activities/{id}/presence.js` locally and restart the host.

For **scraper.json** changes, edit the file under `extension/activities/{id}/` and reload the target tab.

---

## Publishing (maintainers)

| Change | Action |
|---|---|
| New/updated activity (`scraper.json`, metadata, registry) | Merge to `main` — **no XPI** |
| `presence.js` only | Merge to `main`; users **Check for updates** |
| Engine / manifest / popup change | Bump `extension/manifest.json`, run `.\update.ps1` |
| Host SDK / core change | Bump `native-host/version.json`, run `.\update.ps1` or `-HostOnly` |

```powershell
# Engine or extension core change:
.\update.ps1

# Host-only:
.\update.ps1 -HostOnly
```

Users get scraper and presence updates from GitHub without reinstalling Syncr Setup (extension 1.0.20+).

---

## Further reading

- [`native-host/ACTIVITY_SDK.md`](native-host/ACTIVITY_SDK.md): presence builder API, field limits, Discord setup
- [`native-host/activities/_template/presence.js`](native-host/activities/_template/presence.js): copy-paste presence starter
- [`docs/scraper-schema.md`](docs/scraper-schema.md): Scraper Engine v2 rule reference
- [`docs/scraper-engine-v2-spec.md`](docs/scraper-engine-v2-spec.md): full engine spec and "no new XPI" model
- [`extension/activities/reddit/scraper.json`](extension/activities/reddit/scraper.json): full Reddit scraper example
- [`extension/activities/proton-mail/scraper.json`](extension/activities/proton-mail/scraper.json): privacy-first generic activity example

---

## Open source

Syncr is open source. Issues, activity ideas, and pull requests are welcome on [GitHub](https://github.com/Clawb1t/Syncr).

### Documentation

| Doc | Contents |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | How the extension, native host, and Discord IPC work together |
| [`docs/activities.md`](docs/activities.md) | Creating activities, review checklist, release process for maintainers |
| [`docs/host-changelog.md`](docs/host-changelog.md) | What each native host version includes |
| [`docs/extension-changelog.md`](docs/extension-changelog.md) | What each extension version includes |
| [`docs/scraper-schema.md`](docs/scraper-schema.md) | Scraper Engine v2 rule reference |
| [`docs/scraper-engine-v2-spec.md`](docs/scraper-engine-v2-spec.md) | Engine spec and GitHub-only activity model |
| [`native-host/ACTIVITY_SDK.md`](native-host/ACTIVITY_SDK.md) | Presence builder API reference |

The README also has a shorter [contributing overview](#contributing) and [Reddit case study](#case-study-the-reddit-activity).
