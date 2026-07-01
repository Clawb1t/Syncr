# Scraper engine v2 — spec: activities without new XPI

**Status:** Implemented (extension 1.0.20+, engine 2.0.0; current extension 1.0.22)  
**Goal:** Ship **one final engine upgrade** in the Firefox extension, then add or change **any activity** using only GitHub files (`registry.json`, `metadata.json`, `scraper.json`, `presence.js`).

**Related:** [`scraper-schema.md`](scraper-schema.md) (v2 rule reference), [`activities.md`](activities.md) (authoring guide), [`architecture.md`](architecture.md)

---

## 1. Problem statement (historical)

Before Scraper Engine v2, Syncr split activities into two buckets:

| Bucket | How it ran | New activity needed AMO? |
|--------|------------|--------------------------|
| **Remote** | `universal.js` + v1 `scraper.json` | No (simple sites only) |
| **Bundled** | Manifest `content_scripts` + `content-script.js` | Yes |

Bundled existed because the v1 engine only supported URL/DOM-presence rules and static labels. YouTube, Netflix, Reddit, and YouTube Music needed DOM text, attributes, video timing, API calls, and smart change detection.

**Resolved in 1.0.20:** Every activity now uses the same universal host + engine v2. All bundled `content-script.js` files and per-site manifest entries were removed. New sites are **GitHub-only**.

---

## 2. Hard constraints (non-negotiable)

### 2.1 AMO / Firefox policy

Firefox AMO will not approve an extension that **downloads and executes arbitrary JavaScript** from GitHub at runtime (PreMiD-style injection). Syncr must stay **declarative**:

- Allowed: JSON rules interpreted by a fixed engine shipped in the XPI
- Not allowed: `content-script.js` from GitHub, `eval`, `new Function`, WASM loaders, etc.

### 2.2 What “no new XPI” actually means

| Change | New XPI? |
|--------|----------|
| New activity (`scraper.json` + `presence.js` on GitHub) | **No** |
| Fix typo in Proton Mail rules | **No** |
| New site that fits existing primitives | **No** |
| New engine primitive (e.g. JSONPath on fetch response) | **Yes** (once) |
| Engine bugfix (e.g. regex URL matching) | **Yes** |
| Firefox API / manifest change | **Yes** |

**Realistic promise:** No new XPI **per activity**. One last engine release, then GitHub-only activities forever unless the DSL needs a new building block.

### 2.3 Security sandbox

The engine is a **DSL interpreter**, not a general runtime. All v2 features must enforce:

- No arbitrary code execution
- **Fetch allowlist** per activity (`metadata.json` → `fetchOrigins`)
- Max string length on extracted text (default 512, configurable per field)
- Max regex complexity / timeout
- Max rules per scraper (default 64)
- Max poll rate (min 1000 ms)
- Optional **privacy** mode: strip fields matching patterns before send

---

## 3. Current v1 engine (baseline)

**File:** `extension/activities/_runtime/universal.js`

| Capability | v1 |
|------------|-----|
| URL hostname / path / regex / segments | Yes |
| Query + hash params | Yes |
| Selector exists / not exists | Yes |
| Static `emit` + `{url}` `{path}` `{origin}` | Yes |
| Read DOM text / attributes | **No** |
| Read `<video>` state | **No** |
| `fetch()` (same-origin API) | **No** |
| JSON path on response | **No** |
| String transforms (split, replace, template) | **No** |
| Conditional emit fields | **No** |
| Smart change detection (seek threshold) | **No** |
| Custom SPA events (`yt-navigate-finish`) | **No** |
| Multi-profile (old vs new Reddit) | **No** |

---

## 4. Capability matrix — bundled activities → primitives

Each row is a **primitive** the v2 engine must support to migrate that activity off bundled JS.

### 4.1 Proton Mail (already remote)

| Need | v1 | v2 action |
|------|-----|-----------|
| URL + selector rules | Done | Keep |
| Static privacy labels | Done | Keep |

No engine work required.

### 4.2 YouTube (`youtube`)

| Need | Primitive |
|------|-----------|
| Browsing on non-`/watch` paths | `when` + `emit: { browsing: true }` |
| Video ID from `?v=` | `extract.urlParam: "v"` |
| Title from DOM or `document.title` | `extract.selectorText` + `extract.titleSuffix` |
| Channel name + URL | `extract.selectorText`, `extract.selectorAttr` |
| Thumbnail from video ID | `transform.template: "https://i.ytimg.com/vi/{v}/mqdefault.jpg"` |
| Playhead / pause / duration | `extract.video` on `video.html5-main-video` |
| Don’t spam RPC while playing | `changeDetection.seekThreshold: 5` |
| SPA navigation | `events: ["yt-navigate-finish"]` |

### 4.3 YouTube Music (`youtube-music`)

| Need | Primitive |
|------|-----------|
| Title / artist / album | `extract.selectorText`, `transform.split: " • "` |
| Album art URL | `extract.selectorAttr: "src"` + `transform.regexReplace` |
| Video timing | `extract.video` |
| Browsing when no song | `fallback.emit` when required extractors missing |
| SPA navigation | `events: ["yt-navigate-finish"]` |

### 4.4 Reddit (`reddit`)

| Need | Primitive |
|------|-----------|
| Old vs new layout | `profiles` keyed by `when.selectorExists` |
| Post page detection | `when.pathRegex` |
| Title, author, score, comments | `extract.selectorAttr` on `shreddit-post` |
| Subreddit from path | `extract.pathRegex` |
| Search query in context | `extract.urlParam` + `transform.template` |
| OG image with exclusions | `extract.metaContent` + `transform.excludeIfIncludes` |
| Browsing context | `coalesce` of multiple extractors |

### 4.5 Netflix (`netflix`)

| Need | Primitive |
|------|-----------|
| Search mode | `extract.urlParam` |
| Watch / title IDs from path | `extract.pathRegex` |
| Member API metadata | `fetch.json` with `credentials: "include"` |
| Episode / season from JSON | `extract.jsonPath` |
| Video element timing | `extract.video` |
| Thumbnail from JSON | `extract.jsonPath` + `coalesce` |
| Browsing contexts | `when.pathMatches` + static labels |
| Metadata cache per ID | `cache.key: "{movieId}"` |

---

## 5. Architecture after v2

```
┌─────────────────────────────────────────────────────────────┐
│  Firefox XPI (frozen after v2 ship)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ universal.js — Scraper Engine v2                      │  │
│  │  • resolve URL → activity id (background index)       │  │
│  │  • load scraper.json (GitHub → bundle fallback)       │  │
│  │  • run profiles → rules → extract → transform → emit  │  │
│  │  • change detection → activity:update                 │  │
│  └───────────────────────────────────────────────────────┘  │
│  manifest: ONE content_script on http(s)://*/*              │
│  NO per-activity content_scripts                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ GitHub (hot)
┌─────────────────────────────────────────────────────────────┐
│  registry.json                                              │
│  activities/{id}/metadata.json   (origins, fetchOrigins)    │
│  activities/{id}/scraper.json    (declarative logic)          │
│  native-host/activities/{id}/presence.js                      │
└─────────────────────────────────────────────────────────────┘
```

### 5.1 Versioning

| Field | Location | Meaning |
|-------|----------|---------|
| `engineVersion` | `extension/engine-version.json` | Max DSL version this build understands |
| `version` | `scraper.json` | DSL schema version (1 or 2) |
| `minEngineVersion` | `metadata.json` | Minimum `engineVersion` required |
| `minExtensionVersion` | deprecated | Alias for `minEngineVersion` during transition |

Engine refuses to run scrapers where `scraper.version > engineVersion`, surfacing “extension update required” in the popup (same gating as today).

### 5.2 Metadata.json (v2)

```json
{
  "id": "youtube",
  "scraper": "remote",
  "origins": ["*://www.youtube.com/*", "*://www.youtube.com"],
  "fetchOrigins": ["https://www.youtube.com", "https://i.ytimg.com"],
  "minEngineVersion": "2.0.0",
  "privacy": false
}
```

| Field | Purpose |
|-------|---------|
| `scraper` | Always `"remote"` after migration |
| `origins` | URL match for `activity:resolveForUrl` |
| `fetchOrigins` | Allowlist for `fetch` steps (exact origin prefix match) |
| `privacy` | If true, engine drops any field not listed in activity `presence.js` contract |

---

## 6. scraper.json v2 schema

### 6.1 Top-level shape

```json
{
  "version": 2,
  "engineVersion": "2.0.0",
  "pollMs": 2000,
  "events": ["yt-navigate-finish", "popstate", "hashchange"],
  "changeDetection": {
    "seekThreshold": 5,
    "fields": ["title", "paused", "channelName"]
  },
  "cache": {
    "fetch": { "ttlMs": 300000, "maxEntries": 20 }
  },
  "profiles": [],
  "rules": [],
  "default": { "emit": { "browsing": true } }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `version` | `2` | Schema version |
| `pollMs` | number | Poll interval (min 1000) |
| `events` | string[] | Extra listeners that reset state + poll |
| `changeDetection` | object | When to re-send during playback |
| `cache` | object | Fetch / extract caching |
| `profiles` | array | Mutually exclusive layout variants (old/new Reddit) |
| `rules` | array | First match wins (same as v1) |
| `default` | object | Fallback when no rule matches |

### 6.2 Rules and profiles

**Rules** (unchanged mental model): `{ "when": { ... }, "emit": { ... }, "extract": { ... } }`

**Profiles** — run first matching profile, then its rules:

```json
{
  "profiles": [
    {
      "id": "old-reddit",
      "when": { "selectorExists": ".default-header" },
      "rules": [ ... ]
    },
    {
      "id": "new-reddit",
      "when": { "selectorExists": "shreddit-post" },
      "rules": [ ... ]
    }
  ]
}
```

If no profile matches, fall through to top-level `rules`.

### 6.3 `when` conditions (v1 + extensions)

All v1 keys remain. New keys:

| Key | Type | Meaning |
|-----|------|---------|
| `selectorTextIncludes` | `{ selector, includes }` | Element text contains string |
| `selectorAttr` | `{ selector, attr, equals \| includes }` | Attribute match |
| `urlParamExists` | string | Query param present |
| `extractEquals` | `{ ref, value }` | Named extractor equals value |
| `not` | object | Inverts nested when |
| `any` | object[] | OR across when objects |
| `all` | object[] | AND (explicit group) |

### 6.4 `extract` — named values for emit

Extractors run **before** `emit` and populate a **context** object. `emit` references them with `{name}`.

```json
{
  "extract": {
    "videoId":   { "urlParam": "v" },
    "title": {
      "coalesce": [
        { "selectorText": "h1.ytd-watch-metadata yt-formatted-string" },
        { "title": { "stripSuffix": " - YouTube" } },
        { "literal": "Unknown Video" }
      ]
    },
    "channelName": { "selectorText": "ytd-channel-name a" },
    "channelUrl":  { "selectorAttr": { "selector": "ytd-channel-name a", "attr": "href", "stripQuery": true } },
    "thumb":       { "template": "https://i.ytimg.com/vi/{videoId}/mqdefault.jpg" },
    "playback":    { "video": { "selector": "video.html5-main-video", "minReadyState": 2 } }
  },
  "emit": {
    "title": "{title}",
    "channelName": "{channelName}",
    "channelUrl": "{channelUrl}",
    "thumbnailUrl": "{thumb}",
    "currentTime": "{playback.currentTime}",
    "duration": "{playback.duration}",
    "paused": "{playback.paused}",
    "pageUrl": "{url}"
  }
}
```

#### Extractor primitives

| Primitive | JSON shape | Returns |
|-----------|------------|---------|
| **literal** | `{ "literal": "text" }` | Static string |
| **urlParam** | `{ "urlParam": "v" }` | Query string value |
| **pathRegex** | `{ "pathRegex": "/watch/(\\d+)", "group": 1 }` | Capture group |
| **selectorText** | `{ "selectorText": "h1", "trim": true }` | `textContent` |
| **selectorAttr** | `{ "selectorAttr": { "selector": "a", "attr": "href" } }` | Attribute |
| **metaContent** | `{ "metaContent": "og:image" }` | `<meta content>` |
| **title** | `{ "title": { "stripSuffix": " - YouTube" } }` | `document.title` |
| **video** | `{ "video": { "selector": "video", "minReadyState": 2 } }` | `{ currentTime, duration, paused }` |
| **template** | `{ "template": "Hello {name}" }` | Interpolate context |
| **coalesce** | `{ "coalesce": [ ...extractors ] }` | First non-empty |
| **split** | `{ "split": { "source": "{subtitle}", "sep": " • ", "index": 0 } }` | Split string |
| **regexReplace** | `{ "regexReplace": { "source": "{art}", "pattern": "=w\\d+.*$", "replacement": "=w500-h500" } }` | Regex transform |
| **excludeIfIncludes** | `{ "excludeIfIncludes": { "source": "{og}", "needles": ["avatar"] } }` | Empty if blocked |
| **fetchJson** | See §6.5 | Parsed JSON (or sub-path) |
| **jsonPath** | `{ "jsonPath": "$.video.title", "from": "{meta}" }` | JSONPath subset |

Empty / failed extractors return `""` or `null` (configurable). Rules can use `when.required: ["title"]` to skip until DOM ready.

### 6.5 `fetchJson` — same-origin API (Netflix)

```json
{
  "movieId": { "pathRegex": "/watch/(\\d+)", "group": 1 },
  "meta": {
    "fetchJson": {
      "url": "https://www.netflix.com/nq/website/memberapi/release/metadata?movieid={movieId}",
      "credentials": "include",
      "cacheKey": "meta:{movieId}",
      "ttlMs": 300000
    }
  },
  "showTitle": { "jsonPath": "$.video.title", "from": "{meta}" },
  "episodeTitle": {
    "jsonPath": "$.video.seasons[*].episodes[?(@.episodeId==$.video.currentEpisode)].title",
    "from": "{meta}"
  }
}
```

**Sandbox rules:**

- URL must start with an origin in `metadata.fetchOrigins`
- Only `GET` and `POST` (body template optional, v2.1)
- `credentials: "include"` only for same-site requests
- Response max size 2 MB
- JSONPath: limited subset (no arbitrary JS filters in v2.0; use predefined `findEpisode` helper for Netflix — see §6.7)

### 6.6 `emit` modes

Emit merges extracted context into the payload sent to `presence.js`.

| Pattern | Fields | Used by |
|---------|--------|---------|
| **Browsing** | `{ "browsing": true, "browsingContext": "{ctx}" }` | YouTube, Reddit, Netflix |
| **Media playback** | `title`, `currentTime`, `duration`, `paused`, images | YouTube, YT Music |
| **Rich post** | `title`, `author`, `subreddit`, `score`, … | Reddit |
| **Netflix watch** | `mode: "watching"`, season/episode fields | Netflix |
| **Privacy generic** | `mode`, `context` | Proton Mail |

`emit` values are always strings or booleans after template resolution. Numbers (`currentTime`, `duration`) are coerced.

### 6.7 Built-in helpers (engine code, not remote JS)

Some logic is too fragile for JSONPath. Ship **named helpers** in the engine, invoked by scraper reference:

```json
{ "helper": "netflix.findEpisode", "args": { "meta": "{meta}" } }
```

| Helper | Purpose |
|--------|---------|
| `netflix.findEpisode` | Walk seasons/episodes for `currentEpisode` |
| `netflix.pickThumbnail` | Box art / episode still selection |
| `strings.trim`, `strings.stripPrefix` | Common string ops |

Helpers are versioned with the engine. New helpers = new XPI, but **one helper supports one activity family** — not one helper per site.

### 6.8 Change detection

Replaces hand-written poll logic in bundled scripts.

```json
{
  "changeDetection": {
    "seekThreshold": 5,
    "alwaysSendOn": ["mode", "browsing", "search"],
    "compareFields": ["title", "channelName", "paused", "albumArt"],
    "playbackFields": { "time": "currentTime", "paused": "paused" }
  }
}
```

Engine tracks `sentAt` / `sentPos` internally when `playbackFields` is set.

### 6.9 Required DOM / wait behavior

```json
{
  "when": { "pathIncludes": "/watch" },
  "require": ["playback", "title"],
  "emit": null
}
```

If `require` extractors are missing, rule is skipped (not an error). Prevents clearing presence while video buffers.

### 6.10 Fallback when extract fails

```json
{
  "rules": [
  ],
  "fallback": {
    "whenMissing": ["title"],
    "emit": { "browsing": true }
  }
}
```

YouTube Music uses this when no song is loaded.

---

## 7. Example v2 scrapers (abbreviated)

### 7.1 YouTube — watch page

```json
{
  "version": 2,
  "pollMs": 2000,
  "events": ["yt-navigate-finish"],
  "changeDetection": { "seekThreshold": 5, "compareFields": ["title", "channelName", "paused"] },
  "rules": [
    {
      "when": { "not": { "pathIncludes": "/watch" } },
      "emit": { "browsing": true }
    },
    {
      "when": { "pathIncludes": "/watch" },
      "require": ["playback"],
      "extract": {
        "videoId": { "urlParam": "v" },
        "title": { "coalesce": [
          { "selectorText": "h1.ytd-watch-metadata yt-formatted-string" },
          { "title": { "stripSuffix": " - YouTube" } }
        ]},
        "channelName": { "selectorText": "ytd-channel-name a" },
        "channelUrl": { "selectorAttr": { "selector": "ytd-channel-name a", "attr": "href", "stripQuery": true } },
        "thumb": { "template": "https://i.ytimg.com/vi/{videoId}/mqdefault.jpg" },
        "playback": { "video": { "selector": "video.html5-main-video", "minReadyState": 2 } }
      },
      "emit": {
        "title": "{title}",
        "channelName": "{channelName}",
        "channelUrl": "{channelUrl}",
        "thumbnailUrl": "{thumb}",
        "currentTime": "{playback.currentTime}",
        "duration": "{playback.duration}",
        "paused": "{playback.paused}",
        "pageUrl": "{url}"
      }
    }
  ],
  "default": { "emit": { "browsing": true } }
}
```

### 7.2 Proton Mail

Stays mostly v1-compatible. Engine accepts `version: 1` scrapers indefinitely.

### 7.3 Reddit — profile split

See §6.2. Post rule uses `extract.selectorAttr` on `shreddit-post[post-title]`, etc.

### 7.4 Netflix — fetch + video

Combines `fetchJson`, `helper: netflix.findEpisode`, `extract.video`, and browsing/search rules.

Full examples ship in `extension/activities/{id}/scraper.json` during migration.

---

## 8. Engine implementation plan

### Phase A — Core v2 (ship **2.0.0** XPI)

| Task | Unlocks |
|------|---------|
| Refactor `universal.js` → `engine/` modules | Maintainability |
| `extract.*` + context + `{template}` emit | Reddit, partial YouTube |
| `profiles` | Reddit old/new |
| `changeDetection` | YouTube, YT Music |
| `events` config | YouTube SPA |
| `require` / `fallback` | YT Music browsing |
| Remove bundled `content_scripts` from manifest | Single universal injection |
| `minEngineVersion` gating in popup | UX |

**Migrate:** Reddit, YouTube, YouTube Music

### Phase B — Fetch layer (**2.1.0** XPI, or bundled into 2.0.0 if ready)

| Task | Unlocks |
|------|---------|
| `fetchJson` + `fetchOrigins` allowlist | Netflix API |
| `jsonPath` subset | Netflix metadata |
| `cache` for fetch | Netflix performance |
| `helper: netflix.*` | Episode/thumbnail logic |

**Migrate:** Netflix

### Phase C — Cleanup

| Task | |
|------|--|
| Delete all `content-script.js` | |
| Mark `scraper-schema.md` v1 as legacy | |
| Convert Proton Mail to v2 syntax (optional) | |
| CI: validate scraper.json against JSON Schema | |

### Phase D — Ongoing (GitHub only)

New activities authored against v2 docs. Community PRs add `scraper.json` + `presence.js`.

---

## 9. Validation and tooling

### 9.1 JSON Schema

Ship `docs/scraper-v2.schema.json`. CI job:

```
node scripts/validate-scraper.js extension/activities/*/scraper.json
```

### 9.2 Local debug mode

`browser.storage.local.syncrDebugScraper = true` logs per poll:

- matched rule / profile
- extractor values (redacted if `privacy: true`)
- emit payload
- change-detection skip reason

### 9.3 Compatibility tests

Fixture HTML files in `extension/activities/_fixtures/` (no network). Engine unit tests run extract + emit against saved DOM snapshots.

---

## 10. Popup and registry changes

| Area | Change |
|------|--------|
| Activity gating | `minEngineVersion` instead of `minExtensionVersion` |
| Locked card | “Requires engine v2.1.0” with link to extension update |
| Remote-only | `inBundle` no longer means content script; means “known to registry” |
| Updates panel | Show `engineVersion` from manifest |

All activities use `scraper: "remote"`. The bundled registry list only seeds offline fallback.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Site DOM changes break selectors | Hot-fix `scraper.json` on GitHub (fast); no XPI wait |
| DSL can’t express a new site | Add primitive → engine point release |
| Netflix API shape changes | Update helper + scraper on GitHub |
| Fetch abused for tracking | `fetchOrigins` allowlist per activity |
| Engine size / complexity | Modular `engine/`, helpers opt-in per build |
| AMO rejects fetch from content script | Same-origin only; document in review notes |

---

## 12. Success criteria

1. **Zero** manifest `content_scripts` entries except universal host  
2. All five shipping activities run from `scraper.json` on GitHub  
3. Adding a sixth activity requires **only** GitHub files + Discord app setup  
4. Proton Mail–class sites can be added by contributors without engine changes  
5. Engine releases happen **rarely** (primitive additions), not per site  

---

## 13. Open questions

1. **JSONPath vs helpers:** Netflix episode matching — ship minimal JSONPath in 2.0 or only `netflix.findEpisode` helper?  
   **Recommendation:** Helper first; JSONPath in 2.1 for simpler sites.

2. **v1 scraper forever?**  
   **Recommendation:** Yes. Engine runs v1 rules via compatibility shim inside v2 evaluator.

3. **User-submitted activities:** Separate registry repo (`syncr-activities`) or main repo?  
   **Recommendation:** Main repo for now; registry URL already documented as swappable.

4. **Engine in WebExtension polyfill for tests?**  
   **Recommendation:** Extract pure `evaluateScraper(def, document, location)` for Node tests.

---

## 14. Next steps

1. Review and approve this spec  
2. Implement Phase A engine refactor + JSON Schema  
3. Port Reddit (simplest rich extract case) as proof  
4. Port YouTube + YT Music  
5. Implement fetch layer + Netflix  
6. Ship extension **v2.0.0** as the **last required XPI** for new activities  
7. Update README: “Activities are GitHub-only; extension is the engine”
