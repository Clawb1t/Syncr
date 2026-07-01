# Syncr Activity SDK

The native host owns all Discord Rich Presence IPC. Activity authors ship a single `presence.js` that maps scraped page data into a Discord activity using the Syncr SDK — bundled inside `syncr-host.exe` and passed as the second argument to `formatPresence`.

## Activity module contract

Each activity lives in `native-host/activities/{id}/presence.js` and must export:

| Export | Type | Description |
|--------|------|-------------|
| `id` | `string` | Unique activity ID (matches extension registry) |
| `name` | `string` | Display name in Syncr UI |
| `clientId` | `string` | Discord Application ID from the Developer Portal |
| `urlPattern` | `string` | URL match pattern (mirrors extension metadata) |
| `formatPresence` | `(data, syncr) => object` | Maps scraped data to a Discord activity |

Folders prefixed with `_` (e.g. `_template`) are skipped by the loader.

## Quick start

```javascript
module.exports = {
  id:         'my-app',
  name:       'My App',
  clientId:   '123456789012345678',
  urlPattern: '*://example.com/*',

  formatPresence(data, syncr) {
    if (data.browsing) {
      return syncr.browsing({
        type: syncr.ActivityType.Watching,
        name: 'My App',
        logo: 'my_logo',
      });
    }

    return syncr.presence()
      .watching(data.title)
      .details(data.subtitle)
      .state(data.paused ? 'Paused' : 'Watching')
      .largeImage(data.thumb, data.title)
      .smallStatus(data.paused ? 'paused' : 'playing')
      .progressBar(data.currentTime, data.duration, { paused: data.paused })
      .button('Open', data.pageUrl)
      .build();
  },
};
```

See [`activities/_template/presence.js`](activities/_template/presence.js) for a copy-paste starter.

## Activity types

Use constants from `syncr.ActivityType`:

| Constant | Value | Discord label |
|----------|-------|---------------|
| `Playing` | 0 | Playing |
| `Streaming` | 1 | Streaming |
| `Listening` | 2 | Listening to |
| `Watching` | 3 | Watching |
| `Competing` | 5 | Competing in |

Set via builder methods: `.playing()`, `.streaming()`, `.listening()`, `.watching()`, `.competing(name)`.

## PresenceBuilder

Fluent API — chain methods, call `.build()` to get a validated presence object.

### Text fields

| Method | Discord field | Max length |
|--------|---------------|------------|
| `.name(value)` | `name` | 128 |
| `.details(value)` | `details` | 128 |
| `.state(value)` | `state` | 128 |

The `name` field controls the compact status bar (e.g. "Listening to **Track Name**").

### Images

```javascript
.largeImage(imageKeyOrUrl, hoverText)
.smallImage(imageKeyOrUrl, hoverText)
.smallStatus('playing' | 'paused', hoverText)  // convenience wrapper
```

- **Asset keys** (e.g. `'youtube_logo'`) must be uploaded in your Discord Application → Rich Presence → Art Assets.
- **External URLs** (must be `https://`) work for large/small images without portal upload.

### Progress bar / timers

```javascript
// Scrubber bar from playback position (omitted when paused)
.progressBar(currentSec, durationSec, { paused: false })

// Standalone helpers (also available on syncr root)
syncr.progressBar(currentSec, durationSec, { paused })
syncr.progressElapsed(startUnixSec)    // elapsed timer
syncr.progressRemaining(endUnixSec)    // countdown
```

Progress bars use wall-clock timestamps. When paused, omit timestamps so Discord does not keep ticking.

### Buttons

```javascript
.button('Label', 'https://example.com')
.buttons([{ label, url }, ...])  // max 2, https only
```

Button labels: max 32 chars. URLs: max 512 chars, `https://` only.

### Party

```javascript
.party(currentSize, maxSize, optionalPartyId)
```

Shows "3 of 5" in Discord when party size is set.

### Secrets (display only)

```javascript
.secrets({ join: 'secret', spectate: 'secret', match: 'secret' })
```

Enables Join/Spectate button display. Click handling is not implemented yet.

### Metadata (Listening activities)

```javascript
.metadata({ album, artist, title, url, imageUrl })
```

Richer Listening display (Spotify-style album/artist info).

### Other fields

```javascript
.flags(syncr.Flags.Instance | syncr.Flags.Join)
.statusDisplay(syncr.StatusDisplay.Name)   // Name | State | Details
.supportedPlatforms(['desktop'])
.instance(true)
```

## Standalone helpers

Available on the `syncr` object passed to `formatPresence`:

```javascript
syncr.browsing({ type, name, logo, details })
syncr.truncate(str, maxLength)
syncr.sanitizeUrl(url)
syncr.validatePresence(rawObject)  // manual validation
```

## Discord Developer Portal setup

1. Create an Application at [discord.com/developers](https://discord.com/developers/applications).
2. Copy the **Application ID** → use as `clientId` in your `presence.js`.
3. Upload art assets under **Rich Presence → Art Assets** for keys like `playing`, `paused`, `my_logo`.
4. No OAuth or client secret is needed — Syncr uses Discord desktop IPC.

## Field limits

Enforced automatically by `validatePresence`:

| Field | Limit |
|-------|-------|
| name, details, state | 128 chars |
| asset hover text | 128 chars |
| button label | 32 chars |
| button URL | 512 chars |
| party id, secrets | 128 chars |
| buttons | max 2 |

## How activities get merged

| Layer | Location | Who ships it |
|-------|----------|--------------|
| Page scraping | `extension/activities/{id}/content-script.js` | Extension PR |
| UI metadata | `extension/activities/{id}/metadata.json` | Extension PR |
| Discord formatting | `native-host/activities/{id}/presence.js` | Host PR (uses SDK) |

The host hot-updates `presence.js` files from GitHub. The SDK itself ships inside `syncr-host.exe` and updates when users install a newer host.

Extension changes are **not required** to use new SDK features — only `presence.js` and a host update.

## Architecture

```
Extension content script  →  { activityId, data }
       ↓
Native host host.js       →  formatPresence(data, syncr)
       ↓
Syncr SDK                 →  validate + normalize
       ↓
RPCManager                →  SET_ACTIVITY via Discord IPC
```
