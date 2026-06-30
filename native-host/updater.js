'use strict';

/**
 * Syncr Updater — checks GitHub for activity + host updates.
 * Host version is compared via native-host/version.json (NOT the GitHub release tag).
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { ACTIVITIES_DIR, VERSION_FILE } = require('./paths');

const GITHUB_USER   = 'Clawb1t';
const GITHUB_REPO   = 'Syncr';
const GITHUB_BRANCH = 'main';

const RAW = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;
const API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`;

function fetchText(url, hops = 5) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      headers:  { 'User-Agent': 'Syncr-Updater/1.0', Accept: '*/*' },
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
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function fileHash(p) {
  try { return sha256(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function writeAtomic(p, content) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, p);
}

function localVersion() {
  try { return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version ?? '0.0.0'; }
  catch { return '0.0.0'; }
}

function semverGt(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

async function getRemoteHostVersion() {
  const data = await fetchJson(`${RAW}/native-host/version.json`);
  return data.version ?? '0.0.0';
}

async function getReleaseDownloads() {
  const release = await fetchJson(`${API}/releases/latest`);
  const assets = release.assets ?? [];
  const find = (pred) => assets.find(pred)?.browser_download_url ?? null;
  return {
    tag: (release.tag_name ?? '').replace(/^v/, ''),
    setupUrl: find(a => /^Syncr-Setup/i.test(a.name) && a.name.endsWith('.exe')),
    hostUrl:  find(a => a.name === 'syncr-host.exe'),
    xpiUrl:   find(a => a.name === 'syncr.xpi'),
    notes:    release.body ?? '',
  };
}

async function updateActivities(log) {
  const updated = [];
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
      if (sha256(remote) === fileHash(localPath)) return;

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

async function getActivityStatus() {
  const statuses = [];
  let ids;
  try {
    const reg = await fetchJson(`${RAW}/extension/activities/registry.json`);
    ids = reg.activities ?? reg;
  } catch {
    return statuses;
  }

  await Promise.all(ids.map(async id => {
    const localPath = path.join(ACTIVITIES_DIR, id, 'presence.js');
    const local = fileHash(localPath);
    let remote = null;
    try {
      remote = sha256(await fetchText(`${RAW}/native-host/activities/${id}/presence.js`));
    } catch {}

    statuses.push({
      id,
      installed: !!local,
      upToDate:  !!(local && remote && local === remote),
      sourceUrl: `${RAW}/native-host/activities/${id}/presence.js`,
    });
  }));

  return statuses;
}

async function checkHostUpdate(log) {
  const current = localVersion();
  try {
    const latestVersion = await getRemoteHostVersion();

    if (!semverGt(latestVersion, current)) {
      log('info', `Updater: host is current (${current})`);
      return {
        available:      false,
        currentVersion: current,
        latestVersion,
      };
    }

    let downloads = { setupUrl: null, hostUrl: null };
    try { downloads = await getReleaseDownloads(); } catch {}

    log('info', `Updater: host update available — ${current} → ${latestVersion}`);
    return {
      available:      true,
      currentVersion: current,
      latestVersion,
      setupDownloadUrl: downloads.setupUrl,
      hostDownloadUrl:  downloads.hostUrl,
    };
  } catch (err) {
    log('warn', `Updater: host version check failed — ${err.message}`);
    return null;
  }
}

module.exports = {
  updateActivities,
  checkHostUpdate,
  getActivityStatus,
  getRemoteHostVersion,
  getReleaseDownloads,
  localVersion,
};
