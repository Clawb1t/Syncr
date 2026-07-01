# Syncr Privacy Policy

**Last updated:** July 1, 2026

This Privacy Policy describes how **Syncr** (the Firefox extension, native host, and Syncr Setup installer) handles information when you use the software.

Syncr is open source software maintained by Syncr Contributors. The project repository is published at [github.com/Clawb1t/Syncr](https://github.com/Clawb1t/Syncr).

---

## Summary

Syncr is designed to run **locally on your computer**. It does not operate a Syncr-owned cloud service that collects your browsing history.

- Syncr reads information from web pages **only to build Discord Rich Presence** for activities you enable.
- Data is sent from Firefox to a **local native host** on your PC, then to the **Discord desktop app** over local IPC.
- Syncr does **not** require you to log in to Discord inside the extension.
- Syncr does **not** include analytics, advertising, or usage tracking in the extension code.
- You can **disable any activity** at any time in the Syncr popup.

What appears on your Discord profile depends on which sites you use, which activities are enabled, and your Discord privacy settings.

---

## What Syncr does

Syncr shows activity from supported websites in Discord Rich Presence (for example, a video title on YouTube or a repository name on GitHub). To do that, the extension inspects pages you visit that match an enabled activity, extracts the fields defined by that activity's rules, and forwards a formatted summary to Discord through the native host.

---

## Information processed locally

### Web page content

When you visit a site with an **enabled** Syncr activity, the extension may read page data such as:

- Page titles, visible text, URLs, and DOM structure defined by each activity's scraper rules
- Media playback state (for example, current time or paused state on supported video or music sites)
- Public metadata from allowed on-page or same-origin requests defined by an activity (for example, Netflix title metadata)

Each activity only runs on URL patterns listed in its metadata. Activities you have **disabled** are not processed for presence.

Some activities are intentionally limited. For example, **Proton Mail** uses generic labels only (such as "Browsing inbox" or "Viewing an email") and does not read or transmit email subjects, senders, recipients, or message bodies.

### Discord Rich Presence

The native host formats scraped data and sends it to the Discord desktop application using Discord's local Rich Presence IPC. Discord may display this information on your profile according to **your Discord account and privacy settings**.

Syncr does not receive your Discord password, OAuth tokens, or direct messages.

### Settings stored in Firefox

Syncr stores the following in **Firefox local storage** on your device:

- Which activities you have enabled or disabled
- Your preferred transmitting activity (if you set one)
- A cached copy of the remote activity index (used to resolve activities from GitHub)

This data stays in your browser profile and is not sent to a Syncr server.

### Native host files

Syncr Setup installs the native host under your user profile, typically:

`%LOCALAPPDATA%\Syncr\`

This folder may contain:

- `syncr-host.exe` and activity `presence.js` files
- `version.json`
- `host.log` (optional diagnostic log; may include presence payloads and connection events)

These files remain on your computer unless you remove them.

---

## Information sent to third parties

Syncr itself does not send your browsing data to a Syncr-operated backend. The following third-party services are used for **updates and distribution**, not for collecting your activity:

| Service | Purpose | What is sent |
|---|---|---|
| **GitHub** (`raw.githubusercontent.com`, `api.github.com`) | Activity registry, scraper rules, host updates, release downloads | Standard HTTP requests from your PC; no personal account required for public reads |
| **Mozilla Add-ons (AMO)** | Signed extension updates via `updates.json` | Firefox's normal add-on update mechanism |
| **Discord desktop app** | Rich Presence display | Presence fields you enabled (title, status text, images, links, playback timestamps where applicable) |

Syncr does not sell personal information.

---

## What Syncr does not collect

Syncr does not intentionally collect or transmit:

- Passwords, authentication cookies, or private session tokens
- Payment or financial information
- Email message content on privacy-focused activities (where configured)
- A centralized Syncr account or profile
- Analytics, crash reports, or telemetry to Syncr Contributors

The Firefox extension manifest declares **no required data collection permissions** to Mozilla (`data_collection_permissions.required: none`).

---

## Your choices and controls

- **Enable or disable activities** in the Syncr popup toggle list.
- **Choose which activity transmits** when multiple are active (priority or manual switch).
- **Uninstall** the Firefox extension, remove the native host folder, or uninstall via Syncr Setup to stop processing.
- **Review Discord settings** to control who can see your activity and Rich Presence.

---

## Children

Syncr is not directed at children under 13. We do not knowingly collect personal information from children.

---

## Security

Syncr communicates between Firefox and the native host using the browser's **Native Messaging** API on your machine. Presence data is not encrypted end-to-end by Syncr beyond what your operating system and Discord provide for local IPC.

Keep your Discord account, Firefox profile, and PC secure. Only install Syncr from official releases on [GitHub](https://github.com/Clawb1t/Syncr/releases) or Mozilla Add-ons.

---

## Open source and changes to activities

Activity rules (`scraper.json`) and presence formatters (`presence.js`) can be updated from GitHub without a new extension version. Those updates define what each activity reads and what is shown on Discord. You can review activity definitions in the public repository under `extension/activities/` and `native-host/activities/`.

We may update this Privacy Policy from time to time. The **Last updated** date at the top will change when we do. Continued use of Syncr after an update means you accept the revised policy.

---

## Contact

Questions or concerns about privacy:

- Open an issue on GitHub: [github.com/Clawb1t/Syncr/issues](https://github.com/Clawb1t/Syncr/issues)

For Discord-specific privacy practices, see [Discord's Privacy Policy](https://discord.com/privacy).

For Firefox add-on distribution, see [Mozilla's Privacy Policy](https://www.mozilla.org/privacy/).
