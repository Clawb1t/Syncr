# Remote scraper schema (Scraper Engine v2)

All activities use **`scraper.json`** on GitHub. The extension runs `activities/_runtime/universal.js` + **Scraper Engine v2** (`engineVersion` 2.0.0 in `extension/engine-version.json`). There are no bundled `content-script.js` files.

Full spec: [`scraper-engine-v2-spec.md`](scraper-engine-v2-spec.md)

---

## metadata.json

Every remote activity requires:

```json
{
  "id": "my-site",
  "name": "My Site",
  "scraper": "remote",
  "origins": ["*://www.example.com/*"],
  "fetchOrigins": ["https://www.example.com"],
  "minEngineVersion": "2.0.0"
}
```

| Field | Purpose |
|---|---|
| `scraper` | Must be `"remote"` |
| `origins` | URL patterns for activity resolution (include bare host if needed) |
| `fetchOrigins` | Allowlist for `fetchJson` in scraper rules (optional) |
| `minEngineVersion` | Minimum engine version in the installed extension |
| `minExtensionVersion` | Deprecated alias — use `minEngineVersion` |

Add the ID to `extension/activities/registry.json` and ship `native-host/activities/{id}/presence.js`.

**Both files are required.** The extension scrapes the page; the host formats Discord presence. Without `presence.js` on the host, the popup may show “live” but Discord stays empty — use **Install activity** on the card (extension 1.0.23+).

---

## Popup display fields

Every `emit` block must include at least one field the popup can show in **Now playing**:

| Field | Example use |
|---|---|
| `title` | YouTube, Netflix, Reddit posts |
| `context` | Proton Mail (“Browsing inbox”) |
| `details` + optional `state` | GitHub (“Browsing repository” / `owner/repo`) |
| `browsing` + `browsingContext` | Feed/browse modes |

`npm run validate:scrapers` fails if an emit block has none of these — catches blank popup text before release.

Use `{url}` for `pageUrl` so Discord buttons open the current tab.

---

## scraper.json structure

```json
{
  "version": 2,
  "pollMs": 2000,
  "events": ["yt-navigate-finish"],
  "changeDetection": {
    "seekThreshold": 5,
    "compareFields": ["title", "paused"],
    "playbackFields": { "time": "currentTime", "paused": "paused" }
  },
  "profiles": [],
  "rules": [],
  "fallback": { "emit": { "browsing": true } },
  "default": { "emit": { "browsing": true } }
}
```

| Top-level key | Purpose |
|---|---|
| `version` | Must be `2` for new activities |
| `pollMs` | Poll interval (minimum 1000 ms enforced by engine) |
| `events` | Extra window events that reset state and re-poll |
| `changeDetection` | Dedup updates before sending to background |
| `profiles` | Branch rules by site variant (e.g. old vs new Reddit) |
| `rules` | Ordered list of `when` + optional `extract` + `emit` |
| `fallback` / `default` | Payload when no rule matches |

Always wrap output in `"emit"` blocks. Use `"default": { "emit": { ... } }` for fallbacks.

---

## Rule shape

```json
{
  "when": { "pathIncludes": "/watch" },
  "extract": {
    "title": { "selectorText": "h1" },
    "playback": { "video": { "selector": "video", "minReadyState": 2 } }
  },
  "require": ["title", "playback"],
  "emit": {
    "title": "{title}",
    "currentTime": "{playback.currentTime}",
    "paused": "{playback.paused}",
    "pageUrl": "{url}"
  }
}
```

| Rule key | Purpose |
|---|---|
| `when` | Conditions — all must pass (see below) |
| `extract` | Named fields added to context |
| `require` | Skip rule if any listed field is empty |
| `run` | Run a helper; helper return value becomes full payload |
| `emit` | Map context into activity data sent to host |

---

## `when` conditions

| Condition | Example |
|---|---|
| `hostnameIncludes` | `"proton"` or `["mail.", "account."]` |
| `pathIncludes` | `"/inbox"` or `["/all-mail", "/almost-all-mail"]` |
| `pathRegex` | `"/watch/(\\d+)"` with optional `pathRegexFlags` |
| `pathSegmentAfter` | `{ "inbox": 1 }` — segment after folder name (viewing message) |
| `searchParam` | `{ "v": "*" }` |
| `hashParam` / `hashParamAny` | Hash routing (Proton Mail) |
| `selectorExists` / `selectorNotExists` | DOM presence |
| `selectorTextIncludes` | `{ "selector": "h1", "includes": "Draft" }` |
| `any` / `all` / `not` | Combine conditions |

---

## Extractor primitives

| Primitive | Example |
|---|---|
| `literal` | `{ "literal": "Home" }` |
| `urlParam` | `{ "urlParam": "v" }` |
| `pathRegex` | `{ "pathRegex": "/watch/(\\d+)", "group": 1 }` |
| `selectorText` | `{ "selectorText": "h1" }` |
| `selectorAttr` | `{ "selectorAttr": { "selector": "a", "attr": "href" } }` |
| `metaContent` | `{ "metaContent": "og:image" }` |
| `title` | `{ "title": { "stripSuffix": " - YouTube" } }` |
| `video` | `{ "video": { "selector": "video", "minReadyState": 2 } }` |
| `coalesce` | `{ "coalesce": [ ... ] }` — first non-empty wins |
| `split` | `{ "split": { "source": "{x}", "sep": " • ", "index": 0 } }` |
| `regexReplace` | `{ "regexReplace": { "source": "{x}", "pattern": "...", "replacement": "" } }` |
| `template` | `{ "template": "https://i.ytimg.com/vi/{videoId}/mqdefault.jpg" }` |
| `fetchJson` | `{ "fetchJson": { "url": "...", "credentials": "include", "cacheKey": "k:{id}" } }` |
| `helper` | `{ "helper": "reddit.subredditFromPath" }` |

Template placeholders in `emit`: `{field}`, `{nested.field}`, `{url}`, `{origin}`, `{path}`.

---

## `run` (helper output as full payload)

```json
{
  "require": ["meta"],
  "run": { "helper": "netflix.buildWatching", "args": { "meta": "{meta}" } }
}
```

Built-in helpers live in `extension/activities/_runtime/engine/helpers.js` (Reddit, Netflix, etc.). New helpers require an engine/XPI update.

---

## scraper.json v1 (legacy compat)

Engine version 1 scrapers still run via a compatibility shim in `evaluate.js` when `"version": 1` or version is omitted. **All current activities use version 2.** New contributions should use `"version": 2` with `default.emit` wrappers.

---

## What needs a new XPI

| Change | New XPI? |
|---|---|
| New / updated `scraper.json` on GitHub | **No** |
| New `metadata.json` / registry entry | **No** |
| New `presence.js` on GitHub | **No** (host hot-update) |
| New extractor, helper, or engine bugfix | **Yes** |
| Firefox manifest / permission change | **Yes** |

---

## Examples in repo

| Activity | File |
|---|---|
| Proton Mail (privacy, URL/DOM rules) | [`proton-mail/scraper.json`](../extension/activities/proton-mail/scraper.json) |
| YouTube | [`youtube/scraper.json`](../extension/activities/youtube/scraper.json) |
| YouTube Music | [`youtube-music/scraper.json`](../extension/activities/youtube-music/scraper.json) |
| Reddit (profiles + extractors) | [`reddit/scraper.json`](../extension/activities/reddit/scraper.json) |
| Netflix (fetchJson + helpers) | [`netflix/scraper.json`](../extension/activities/netflix/scraper.json) |

Validate locally:

```powershell
npm run validate:scrapers
npm run test:engine
```
