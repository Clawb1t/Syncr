# Remote scraper schema (v1)

Remote activities ship a **`scraper.json`** file on GitHub instead of a bundled `content-script.js`. The extension injects `activities/_runtime/runner.js`, fetches this file, and runs the declarative engine.

Use remote scrapers for simple sites (URL rules, DOM selectors, static labels). Complex integrations (API calls, video progress, rich parsing) still use **bundled** `content-script.js` until the engine grows.

---

## metadata.json

```json
{
  "id": "my-site",
  "scraper": "remote",
  "origins": ["*://www.example.com/*"],
  "minExtensionVersion": "1.0.13"
}
```

| Field | Purpose |
|---|---|
| `scraper` | Must be `"remote"` |
| `origins` | Host patterns passed to `browser.permissions.request` |
| `minExtensionVersion` | Minimum extension with the dynamic loader |

Also add the ID to `extension/activities/registry.json` and ship `native-host/activities/{id}/presence.js`.

---

## scraper.json shape

```json
{
  "version": 1,
  "pollMs": 2000,
  "rules": [
    {
      "when": { "pathIncludes": "/search", "searchParam": { "q": "*" } },
      "emit": { "mode": "search", "searchQuery": "from-url" }
    }
  ],
  "default": { "browsing": true, "browsingContext": "Example" }
}
```

Rules are evaluated top to bottom. The first matching rule wins. If none match, `default` is used.

---

## `when` conditions

All conditions in a `when` object must pass (AND logic).

| Key | Type | Meaning |
|---|---|---|
| `hostnameIncludes` | string or string[] | `location.hostname` contains text |
| `pathIncludes` | string or string[] | pathname contains text (lowercased) |
| `pathRegex` | string | regex tested against pathname |
| `pathRegexFlags` | string | optional regex flags (default `i`) |
| `searchParam` | object | query param key → exact value, or `"*"` for any value |
| `hashParam` | object | hash query param key → exact value, or `"*"` |
| `hashParamAny` | string[] | at least one hash param key is present |
| `selectorExists` | string or string[] | any selector matches in DOM |
| `selectorNotExists` | string or string[] | none of the selectors match |
| `pathSegmentAfter` | object | folder name → min segments after it (OR across keys) |

---

## `emit` payload

Static key/value pairs sent to the native host as activity `data`. String values support templates:

| Template | Replaced with |
|---|---|
| `{url}` | full page URL |
| `{origin}` | page origin |
| `{path}` | pathname |

The emitted object must match what your `presence.js` expects.

---

## Example

See [`extension/activities/proton-mail/scraper.json`](../extension/activities/proton-mail/scraper.json).

---

## What still needs a new AMO build

| Change | New AMO? |
|---|---|
| New remote `scraper.json` on GitHub | No |
| New `presence.js` on GitHub | No |
| New `registry.json` entry on GitHub | No |
| New bundled `content-script.js` | Yes |
| Engine changes in `_runtime/runner.js` | Yes |
