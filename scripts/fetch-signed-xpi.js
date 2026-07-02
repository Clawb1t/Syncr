#!/usr/bin/env node
/**
 * Download the signed XPI for a version from AMO.
 * With --wait, polls until review finishes (typically 5–10 minutes).
 *
 * Usage:
 *   node scripts/fetch-signed-xpi.js [version] [--wait] [--wait-minutes 25] [--poll-seconds 30]
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
const addonId = manifest.browser_specific_settings?.gecko?.id || 'syncr@clawb1t';

const args = process.argv.slice(2);
let version = manifest.version;
let wait = false;
let waitMinutes = 25;
let pollSeconds = 30;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--wait') wait = true;
  else if (args[i] === '--wait-minutes') waitMinutes = Number(args[++i]) || 25;
  else if (args[i] === '--poll-seconds') pollSeconds = Number(args[++i]) || 30;
  else if (!args[i].startsWith('--')) version = args[i];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadEnv() {
  const fromProcess = {
    issuer: process.env.AMO_JWT_ISSUER || process.env.WEB_EXT_API_KEY,
    secret: process.env.AMO_JWT_SECRET || process.env.WEB_EXT_API_SECRET,
  };
  if (fromProcess.issuer && fromProcess.secret) return fromProcess;

  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error('AMO credentials missing — set AMO_JWT_ISSUER + AMO_JWT_SECRET in .env or env vars');
  }
  let text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) vars[m[1].trim()] = m[2].trim();
  }
  const issuer = vars.AMO_JWT_ISSUER || vars.WEB_EXT_API_KEY;
  const secret = vars.AMO_JWT_SECRET || vars.WEB_EXT_API_SECRET;
  if (!issuer || !secret) throw new Error('AMO_JWT_ISSUER and AMO_JWT_SECRET required in .env');
  return { issuer, secret };
}

function makeJwt(issuer, secret) {
  const b64url = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url({
    iss: issuer,
    iat: now,
    exp: now + 300,
    jti: String(Math.random()),
  });
  const sig = crypto.createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

function request(url, { jwt, accept = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { Accept: accept };
    if (jwt) headers.Authorization = `JWT ${jwt}`;
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
    };
    const req = https.request(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        request(res.headers.location, { jwt, accept }).then(resolve).catch(reject);
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.toString().slice(0, 500)}`));
          return;
        }
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function isApproved(entry) {
  if (!entry?.file?.url) return false;
  const status = entry.file.status;
  if (status === 'awaiting_review' || status === 'unreviewed') return false;
  if (status === 'rejected' || status === 'disabled' || status === 'deleted') {
    throw new Error(`AMO rejected v${entry.version} (status: ${status})`);
  }
  return true;
}

async function findVersionEntry(jwt, targetVersion) {
  const encodedId = encodeURIComponent(addonId);
  const versionsUrl = `https://addons.mozilla.org/api/v5/addons/addon/${encodedId}/versions/?page_size=25`;

  const { body } = await request(versionsUrl, { jwt });
  const data = JSON.parse(body.toString());
  const results = data.results ?? [];

  const exact = results.find(v => v.version === targetVersion);
  if (exact) return exact;

  // Fallback: addon detail sometimes lists latest before versions API indexes it
  const addonUrl = `https://addons.mozilla.org/api/v5/addons/addon/${encodedId}/`;
  const addonRes = await request(addonUrl, { jwt });
  const addon = JSON.parse(addonRes.body.toString());
  const candidates = [addon.latest_unlisted_version, addon.current_version].filter(Boolean);
  return candidates.find(v => v.version === targetVersion) ?? null;
}

async function waitForApproved(issuer, secret, targetVersion) {
  const deadline = Date.now() + waitMinutes * 60 * 1000;
  let attempt = 0;

  console.log(`Waiting for AMO to finish reviewing v${targetVersion} (up to ${waitMinutes} min)…`);

  while (Date.now() < deadline) {
    attempt++;
    const jwt = makeJwt(issuer, secret);
    const entry = await findVersionEntry(jwt, targetVersion);

    if (entry && isApproved(entry)) {
      console.log(`Approved after ${attempt} check(s) (status: ${entry.file.status})`);
      return entry;
    }

    const status = entry?.file?.status ?? 'not submitted yet';
    const elapsed = Math.floor((Date.now() - (deadline - waitMinutes * 60 * 1000)) / 1000);
    console.log(`  [${elapsed}s] Still waiting — ${status}. Next check in ${pollSeconds}s…`);

    await sleep(pollSeconds * 1000);
  }

  throw new Error(
    `Timed out after ${waitMinutes} minutes waiting for AMO to approve v${targetVersion}. ` +
    'Check https://addons.mozilla.org/developers/addons — then re-run: bun run update -- -PublishOnly'
  );
}

async function main() {
  const { issuer, secret } = loadEnv();

  console.log(`Fetching signed XPI for ${addonId} v${version}…`);

  const entry = wait
    ? await waitForApproved(issuer, secret, version)
    : await findVersionEntry(makeJwt(issuer, secret), version);

  if (!entry) {
    throw new Error(`No signed version found on AMO for v${version}. Check the developer dashboard.`);
  }
  if (!wait && !isApproved(entry)) {
    throw new Error(
      `v${version} is on AMO but not approved yet (status: ${entry.file.status}). ` +
      'Re-run with --wait or wait a few minutes and try again.'
    );
  }

  const fileUrl = entry.file?.url;
  if (!fileUrl) throw new Error('No download URL on AMO version entry');

  console.log(`Downloading (${entry.file.size} bytes, status: ${entry.file.status})…`);
  const dl = await request(fileUrl, { jwt: makeJwt(issuer, secret), accept: 'application/x-xpinstall' });

  const outDir = path.join(root, 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'syncr.xpi');
  fs.writeFileSync(outPath, dl.body);

  console.log(`Saved: dist/syncr.xpi`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
