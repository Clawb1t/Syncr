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

### Step 1 — Run Syncr Setup

1. Go to [GitHub Releases](https://github.com/Clawb1t/Syncr/releases/latest)
2. Download **`Syncr-Setup-<version>.exe`** (e.g. `Syncr-Setup-1.0.5.exe`)
3. Run it — setup happens automatically (no admin password required)
4. When Firefox opens the extension file, click **Add to Firefox**
5. Close Syncr Setup when the Done screen appears

Syncr Setup installs the native host to your user folder (`%LOCALAPPDATA%\Syncr`) and registers it with Firefox. **Every time you run Setup**, it re-downloads the signed extension and activities from GitHub — cached files are never reused, so stale or unsigned XPIs cannot break your install.

### Step 2 — Use Syncr

1. Make sure **Discord is open** on your PC (desktop app, not browser)
2. Visit a supported site (e.g. [YouTube Music](https://music.youtube.com) or [YouTube](https://www.youtube.com))
3. Your activity appears on your Discord profile

If the popup shows **Disconnected**, click **Get Syncr Setup** in the footer to download and run Syncr Setup again, or click **Reconnect** after the host is installed.

---

## Troubleshooting

| Issue | Fix |
|---|---|
| Popup shows **Disconnected** | Download the latest **Syncr-Setup-*.exe** from [GitHub Releases](https://github.com/Clawb1t/Syncr/releases/latest) and run it again |
| Firefox didn't prompt to add the extension | Open the popup → **Get Syncr Setup**, or manually download **`syncr.xpi`** from releases and double-click it |
| Nothing on Discord | Confirm the Discord **desktop app** is running (not discord.com in a browser tab) |
| Host or activity update available | Open the popup → **Updates** → **Check for updates**, then download or run Syncr Setup as shown |

---

## Supported activities

- **YouTube Music** — listening status with album art and progress bar
- **YouTube** — watching status with video title and channel

More activities can be added via GitHub without reinstalling Syncr (metadata and Discord formatting). New sites that need page scraping require an extension update.

---

## Releasing (developers)

### One-time setup

1. Install [GitHub CLI](https://cli.github.com/) and run `gh auth login`
2. Create AMO API credentials:
   - Sign in at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/)
   - Open your profile menu → **Tools** → **API Credentials**
   - Or go directly to [addons.mozilla.org/developers/addon/api/key](https://addons.mozilla.org/developers/addon/api/key/)
   - Click **Generate new credentials**
3. Add GitHub repository secrets (Settings → Secrets → Actions):
   - `AMO_JWT_ISSUER` — JWT issuer from AMO
   - `AMO_JWT_SECRET` — JWT secret from AMO

### Publish a new version

When the **extension bundle** changes (popup, manifest, content scripts):

1. Bump `version` in `extension/manifest.json`
2. Run:

```powershell
.\update.ps1
```

Or: `npm run update`

That's one command. It will:

- Sign the extension via AMO (or fetch if already approved)
- Build `syncr-host.exe` and `Syncr-Setup-<version>.exe`
- Update `updates.json`
- Commit, push, tag, and create the GitHub release

**Requirements:** `.env` with AMO credentials, `git` (GitHub Desktop includes this), and either [GitHub CLI](https://cli.github.com/) (`gh auth login`) or a `GITHUB_TOKEN` in `.env` ([create token](https://github.com/settings/tokens) with **repo** scope).

GitHub Desktop can't be driven by scripts, but it uses the same git repo — after `update.ps1` runs, open Desktop and you'll see the new commit and tag.

Build only (no git/GitHub):

```powershell
.\update.ps1 -BuildOnly
```

### Manual builds

Individual build scripts still exist if needed:

| Script | Output |
|---|---|
| `.\scripts\build-xpi.ps1` | Unsigned zip for manual AMO upload |
| `cd native-host && npm run build` | `dist/syncr-host.exe` |
| `cd launcher && .\build.ps1` | `launcher/dist/Syncr-Setup-<version>.exe` |

### When to publish a new extension version

| Change | Extension update needed? |
|---|---|
| `presence.js` formatting tweaks | No — host updater handles it |
| Activity metadata/logos on GitHub | No — popup fetches live |
| `syncr-host.exe` bug fix | No — re-run Syncr Setup |
| New activity content script or manifest URL | **Yes** |
| Popup/background logic or permissions | **Yes** |

---

## License

Open source — contributions welcome.
