# Syncr

Discord Rich Presence for Firefox. Shows what you're doing on the web — directly in your Discord profile. No backend, no server, no setup commands.

---

## How it works

Syncr connects directly to the Discord client running on your machine via Discord's built-in local WebSocket RPC server (ports 6463-6472). Every Discord installation exposes this server locally — Syncr just talks to it.

```
YouTube Music tab
  → content script (reads DOM)
    → background script
      → Discord's local WebSocket (127.0.0.1:6463)
        → your Discord profile
```

---

## Setup

### 1. Add your Discord app's Client Secret

For each activity, open its file in `extension/activities/` and paste the Client Secret from your Discord application.

For YouTube Music, open `extension/activities/youtube-music.js` and find:

```js
clientSecret: '', // ← paste your Discord app's Client Secret here
```

Get your secret from [discord.com/developers/applications](https://discord.com/developers/applications) → your app → OAuth2 → Client Secret.

> The Client Secret is only used locally to exchange an auth code for a token. It is never sent anywhere except Discord's own API.

### 2. Load the extension in Firefox

- Open `about:debugging` in Firefox
- Click **This Firefox** → **Load Temporary Add-on**
- Pick `extension/manifest.json`

That's it.

### 3. First use — authorize once

The first time you open a tracked site (e.g. YouTube Music), Discord will show a **native popup** asking:

> "Syncr wants to: Set your Rich Presence activity"

Click **Authorize**. This happens once. The token is stored in the extension and auto-refreshed forever.

---

## Adding a new activity

### 1. Create `extension/activities/my-activity.js`

```js
(function () {
  self.SyncrActivities = self.SyncrActivities || new Map();

  self.SyncrActivities.set('my-activity', {
    id: 'my-activity',
    name: 'My Activity',
    clientId: 'YOUR_DISCORD_APP_CLIENT_ID',
    clientSecret: 'YOUR_DISCORD_APP_CLIENT_SECRET',
    urlPattern: '*://example.com/*',

    formatPresence(data) {
      return {
        details: data.title,
        state: data.subtitle,
        large_image: data.thumbnailUrl,  // https:// URL or asset key
        large_text: 'Hover text',
        small_image: 'icon_key',
        small_text: 'Hover text',
        timestamps: {
          start: Math.floor(Date.now() / 1000) - data.elapsed,
          end:   Math.floor(Date.now() / 1000) + data.remaining,
        },
        buttons: [{ label: 'Open', url: data.url }],
      };
    },
  });
})();
```

### 2. Create `extension/content-scripts/my-activity.js`

```js
(function () {
  const ACTIVITY_ID = 'my-activity';
  const POLL_MS = 2000;

  function scrape() {
    // read the page DOM and return a data object
    return { title: document.title, ... };
  }

  setInterval(() => {
    const data = scrape();
    if (!data) {
      browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID });
      return;
    }
    browser.runtime.sendMessage({ type: 'activity:update', activityId: ACTIVITY_ID, data });
  }, POLL_MS);
})();
```

### 3. Register both in `extension/manifest.json`

Add the activity script to `background.scripts` **before** `lib/discord-rpc.js`:

```json
"background": {
  "scripts": [
    "activities/youtube-music.js",
    "activities/my-activity.js",
    "lib/discord-rpc.js",
    "background/background.js"
  ]
}
```

Add the content script entry:

```json
"content_scripts": [
  {
    "matches": ["*://example.com/*"],
    "js": ["content-scripts/my-activity.js"],
    "run_at": "document_idle"
  }
]
```

Reload the extension in `about:debugging` and you're done.

---

## Discord app setup (per activity)

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create a new application (one per activity, so each has its own icon set)
3. Copy the **Application ID** → `clientId` in the activity file
4. Copy the **Client Secret** (OAuth2 tab) → `clientSecret` in the activity file
5. Under **Rich Presence → Art Assets**, upload icons:
   - `playing` — the play icon shown in the small corner image
   - `paused` — the pause icon
6. External image URLs (`https://...`) work as `large_image` without uploading anything

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Nothing appears in Discord | Make sure Discord is open, then reload the extension |
| "clientSecret is empty" in console | Paste your secret into the activity file |
| Authorize popup never appeared | Check `about:debugging` console for connection errors |
| Token expired / auth loop | Clear extension storage in `about:debugging` → Inspect → Storage |
