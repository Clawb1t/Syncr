# Syncr

Discord Rich Presence for Firefox. Shows what you're doing on the web — directly in your Discord profile. No Discord login, no cloud backend.

---

## How it works

```
YouTube / YouTube Music tab
  → content script (reads the page)
    → Firefox extension (background)
      → native host (local app)
        → Discord desktop app (local IPC)
          → your Discord profile
```

Activities (what shows in the popup) are loaded live from GitHub. Presence formatting is updated automatically by the native host. Your enable/disable preferences stay in local storage.

---

## Installation

### Step 1 — Install the Firefox extension

1. Go to [GitHub Releases](https://github.com/Clawb1t/Syncr/releases/latest)
2. Download **`syncr.xpi`**
3. Double-click it (or drag it into Firefox)
4. Click **Add to Firefox** when prompted

### Step 2 — Install the native host (one time)

1. Click the **Syncr** icon in your Firefox toolbar
2. Follow the setup wizard:
   - Click **Get started**, then **Download & Install Host**
   - When Windows asks to run the file, click **Run**
   - If SmartScreen appears: **More info** → **Run anyway**
   - Wait for the script window to say **Done**, then press Enter
3. The popup will connect automatically and show **Connected**

No administrator password is required — everything installs to your user folder.

### Step 3 — Use Syncr

1. Make sure **Discord is open** on your PC (desktop app, not browser)
2. Visit a supported site (e.g. [YouTube Music](https://music.youtube.com) or [YouTube](https://www.youtube.com))
3. Your activity appears on your Discord profile

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Popup shows **Disconnected** | Click **Run setup** in the footer and reinstall the host |
| Script won't run | Open Downloads → `Syncr` folder → right-click `install-host.ps1` → **Run with PowerShell** |
| SmartScreen blocked it | Click **More info** → **Run anyway** |
| Nothing on Discord | Confirm the Discord **desktop app** is running (not discord.com in a browser tab) |
| Host update available | Click **Update host** in the popup banner and run the setup wizard again |

---

## Supported activities

- **YouTube Music** — listening status with album art and progress bar
- **YouTube** — watching status with video title and channel

More activities can be added via GitHub without reinstalling Syncr (metadata and Discord formatting). New sites that need page scraping require an extension update.

---

## Building (developers)

### Requirements

- [Node.js](https://nodejs.org/) 18+
- npm

### Build unsigned extension zip

```powershell
.\scripts\build-xpi.ps1
```

Output: `dist/syncr-{version}-unsigned.zip` — upload to [AMO Developer Hub](https://addons.mozilla.org/developers/) for signing.

### Build native host executable

```powershell
cd native-host
npm install
npm run build
```

Output: `dist/syncr-host.exe` — attach to GitHub releases alongside `syncr.xpi`.

### GitHub release checklist

Each release `vX.Y.Z` should include:

- **`syncr.xpi`** — Mozilla-signed extension
- **`syncr-host.exe`** — native messaging host

After AMO signs a new extension version, update [`updates.json`](updates.json) with the new version, download URL, and SHA-256 hash of the signed XPI.

### When to publish a new extension version

| Change | Extension update needed? |
|---|---|
| `presence.js` formatting tweaks | No — host updater handles it |
| Activity metadata/logos on GitHub | No — popup fetches live |
| `syncr-host.exe` bug fix | No — re-run setup wizard |
| New activity content script or manifest URL | **Yes** |
| Popup/background logic or permissions | **Yes** |

---

## License

Open source — contributions welcome.
