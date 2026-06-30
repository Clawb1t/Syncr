'use strict';

/**
 * Syncr Updater
 *
 * Checks the public GitHub repo for:
 *   1. New or updated activity presence files  → downloaded & replaced in-place
 *   2. A newer native-host release             → notified to the extension
 *
 * All network calls are fire-and-forget; failures are logged but never crash
 * the host.  Set GITHUB_USER and GITHUB_REPO to your public repository before
 * distributing.
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ─── Configure once when you push to GitHub ─────────────────────────────────
const GITHUB_USER   = 'Clawb1t';
const GITHUB_REPO   = 'Syncr';
const GITHUB_BRANCH = 'main';
// ────────────────────────────────────────────────────────────────────────────

const RAW  = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const API  = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;

const ACTIVITIES_DIR = path.join(__dirname, 'activities');
const VERSION_FILE   = path.join(__dirname, 'version.json');

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

/** Fetch a URL to a string.  Follows up to 5 redirects. */
function fetchText(url, hops = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      headers:  { 'User-Agent': 'Syncr-Updater/1.0', 'Accept': '*/*' },
    }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && hops > 0) {
        return fetchText(res.headers.location, hops - 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end',  () => resolve(body));
    }).on('error', reject);
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fileHash(p) {
  try { return sha256(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

/** Atomic write — write to .tmp then rename so partial writes never corrupt */
function writeAtomic(p, content) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

function localVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
}

/** Returns true if semver a is strictly greater than b */
function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1 — Activity updater
// ---------------------------------------------------------------------------

/**
 * Fetches the registry from GitHub, then for each activity compares the
 * remote presence.js SHA-256 against the local copy.  If they differ the
 * local file is replaced.
 *
 * @param {Function} log  host.js–style log(level, ...args) function
 * @returns {string[]}    IDs of activities that were updated / newly added
 */
async function updateActivities(log) {
  const updated = [];

  // Master registry lives alongside the extension activities
  let ids;
  try {
    const reg = await fetchJson(`${RAW}/extension/activities/registry.json`);
    ids = reg.activities ?? reg;
  } catch (err) {
    log('warn', `Updater: could not fetch registry — ${err.message}`);
    return updated;
  }

  await Promise.all(ids.map(async id => {
    const url       = `${RAW}/native-host/activities/${id}/presence.js`;
    const localPath = path.join(ACTIVITIES_DIR, id, 'presence.js');

    try {
      const remote = await fetchText(url);
      if (sha256(remote) === fileHash(localPath)) return; // already current

      fs.mkdirSync(path.join(ACTIVITIES_DIR, id), { recursive: true });
      writeAtomic(localPath, remote);
      log('info', `Updater: activity "${id}" updated`);
      updated.push(id);
    } catch (err) {
      log('warn', `Updater: skipping "${id}" — ${err.message}`);
    }
  }));

  return updated;
}

// ---------------------------------------------------------------------------
// 2 — Host version check
// ---------------------------------------------------------------------------

/**
 * Checks GitHub Releases for a version newer than version.json.
 *
 * @param {Function} log
 * @returns {{ available: boolean, latestVersion: string, downloadUrl: string|null, releaseNotes: string }|null}
 */
async function checkHostUpdate(log) {
  try {
    const release       = await fetchJson(`${API}/releases/latest`);
    const latestVersion = (release.tag_name ?? '0.0.0').replace(/^v/, '');
    const current       = localVersion();

    if (!semverGt(latestVersion, current)) {
      log('info', `Updater: host is current (${current})`);
      return { available: false, latestVersion };
    }

    // Find the host zip asset in the release
    const asset = release.assets?.find(a =>
      /syncr[_-]?host/i.test(a.name) && a.name.endsWith('.zip')
    ) ?? release.assets?.[0];

    log('info', `Updater: host update available — ${current} → ${latestVersion}`);
    return {
      available:     true,
      latestVersion,
      downloadUrl:   asset?.browser_download_url ?? null,
      releaseNotes:  release.body ?? '',
    };
  } catch (err) {
    log('warn', `Updater: host version check failed — ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------

module.exports = { updateActivities, checkHostUpdate };
