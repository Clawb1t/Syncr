# Remote scraper schema

Remote activities ship **`scraper.json`** on GitHub. The extension runs `activities/_runtime/universal.js` + **Scraper Engine v2** (`engineVersion` 2.0.0). No bundled `content-script.js`.

Full spec: [`scraper-engine-v2-spec.md`](scraper-engine-v2-spec.md)

---

## metadata.json

```json
{
  "id": "my-site",
  "scraper": "remote",
  "origins": ["*://www.example.com/*"],
  "fetchOrigins": ["https://www.example.com"],
  "minEngineVersion": "2.0.0"
}
```

| Field | Purpose |
|---|---|
| `scraper` | Must be `"remote"` |
| `origins` | URL patterns for activity resolution |
| `fetchOrigins` | Allowlist for `fetchJson` (optional) |
| `minEngineVersion` | Minimum `engine-version.json` in the extension |

Add the ID to `extension/activities/registry.json` and ship `native-host/activities/{id}/presence.js`.

---

## scraper.json v1 (legacy)

Proton Mail uses v1: static `when` + `emit`. Engine runs v1 via compatibility shim when `"version": 1`.

---

## scraper.json v2

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
  "rules": [
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
        "paused": "{playback.paused}"
      }
    }
  ],
  "fallback": { "emit": { "browsing": true } },
  "default": { "emit": { "browsing": true } }
}
```

### Extractor primitives

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
| `coalesce` | `{ "coalesce": [ ... ] }` |
| `split` | `{ "split": { "source": "{x}", "sep": " • ", "index": 0 } }` |
| `regexReplace` | `{ "regexReplace": { "source": "{x}", "pattern": "...", "replacement": "" } }` |
| `template` | `{ "template": "https://i.ytimg.com/vi/{videoId}/mqdefault.jpg" }` |
| `fetchJson` | `{ "fetchJson": { "url": "...", "credentials": "include", "cacheKey": "k:{id}" } }` |
| `helper` | `{ "helper": "netflix.buildWatching", "args": { "meta": "{meta}" } }` |

### `run` (helper output as full payload)

```json
{
  "require": ["meta"],
  "run": { "helper": "netflix.buildWatching", "args": { "meta": "{meta}" } }
}
```

---

## What needs a new AMO build

| Change | New AMO? |
|---|---|
| New / updated `scraper.json` on GitHub | **No** |
| New `presence.js` on GitHub | **No** |
| New `registry.json` entry | **No** |
| New engine primitive or engine bugfix | **Yes** |

---

## Examples

| Activity | File |
|---|---|
| Proton Mail (v1) | [`proton-mail/scraper.json`](../extension/activities/proton-mail/scraper.json) |
| YouTube | [`youtube/scraper.json`](../extension/activities/youtube/scraper.json) |
| Reddit | [`reddit/scraper.json`](../extension/activities/reddit/scraper.json) |
| Netflix | [`netflix/scraper.json`](../extension/activities/netflix/scraper.json) |

Validate locally: `npm run validate:scrapers`
