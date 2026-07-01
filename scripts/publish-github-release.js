#!/usr/bin/env node
/**
 * Create/update a GitHub release and upload assets (no gh CLI required).
 * Usage: node scripts/publish-github-release.js <tag> <repo> <xpi> <host> <setup>
 */
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const [tag, repo, xpiPath, hostPath, setupPath] = process.argv.slice(2);
if (!tag || !repo || !xpiPath || !hostPath || !setupPath) {
  console.error('Usage: node scripts/publish-github-release.js <tag> <owner/repo> <xpi> <host> <setup>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const version = tag.replace(/^v/, '');

const TOKEN_HELP = `
GitHub token rejected (403). Fix your GITHUB_TOKEN in .env:

Classic token (easiest):
  1. https://github.com/settings/tokens → Generate new token (classic)
  2. Check the "repo" scope (full repository access)
  3. Paste into .env as GITHUB_TOKEN=ghp_...

Fine-grained token:
  1. https://github.com/settings/tokens?type=beta → Generate new token
  2. Repository access: select "Clawb1t/Syncr" (or All repositories)
  3. Permissions → Repository permissions → Contents: Read and write
  4. Paste into .env as GITHUB_TOKEN=github_pat_...

Then re-run: npm run update -- -PublishOnly
`;

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) throw new Error('.env not found');
  let text = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) vars[m[1].trim()] = m[2].trim();
  }
  const token = vars.GITHUB_TOKEN || vars.GH_TOKEN;
  if (!token) {
    throw new Error('GITHUB_TOKEN not found in .env');
  }
  return token;
}

function apiRequest(method, url, token, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {
      'User-Agent': 'Syncr-Update',
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (body) headers['Content-Type'] = 'application/json';
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method, headers };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let data = raw.toString();
        try { data = JSON.parse(data); } catch { /* text */ }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function normalizeUploadUrl(uploadUrl, fileName) {
  // GitHub returns: .../assets{?name,label} — strip the template suffix
  const base = uploadUrl.replace(/\{[^}]*\}$/, '');
  return `${base}?name=${encodeURIComponent(fileName)}`;
}

function uploadAsset(uploadUrl, token, filePath) {
  return new Promise((resolve, reject) => {
    const name = path.basename(filePath);
    const data = fs.readFileSync(filePath);
    const u = new URL(normalizeUploadUrl(uploadUrl, name));
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'User-Agent': 'Syncr-Update',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/octet-stream',
        'Content-Length': data.length,
      },
    };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        if (res.statusCode >= 400) {
          reject(new Error(`Upload ${name} failed: HTTP ${res.statusCode} ${body.slice(0, 300)}`));
          return;
        }
        resolve(name);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function deleteExistingAsset(token, repoSlug, releaseId, assetName) {
  const res = await apiRequest('GET', `https://api.github.com/repos/${repoSlug}/releases/${releaseId}`, token);
  if (res.status !== 200) return;
  const existing = (res.data.assets || []).find((a) => a.name === assetName);
  if (existing) {
    await apiRequest('DELETE', `https://api.github.com/repos/${repoSlug}/releases/assets/${existing.id}`, token);
  }
}

async function verifyToken(token, repoSlug) {
  const res = await apiRequest('GET', `https://api.github.com/repos/${repoSlug}`, token);
  if (res.status === 200) return;
  if (res.status === 404) {
    throw new Error(`Repository ${repoSlug} not found or token cannot access it.${TOKEN_HELP}`);
  }
  if (res.status === 403) {
    throw new Error(`Token cannot access ${repoSlug}.${TOKEN_HELP}`);
  }
  throw new Error(`Token check failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
}

async function getOrCreateRelease(token, repoSlug) {
  const base = `https://api.github.com/repos/${repoSlug}/releases`;

  let res = await apiRequest('GET', `${base}/tags/${tag}`, token);
  if (res.status === 200) return res.data;
  if (res.status === 403) throw new Error(`Cannot read releases.${TOKEN_HELP}`);

  res = await apiRequest('POST', base, token, {
    tag_name: tag,
    name: `Syncr v${version}`,
    generate_release_notes: true,
  });

  if (res.status === 201) return res.data;
  if (res.status === 403) throw new Error(`Cannot create release.${TOKEN_HELP}`);

  if (res.status === 422) {
    const list = await apiRequest('GET', base, token);
    const existing = (list.data || []).find((r) => r.tag_name === tag);
    if (existing) return existing;
  }

  throw new Error(`Create release failed: HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
}

async function main() {
  const token = loadEnv();
  const assets = [
    path.resolve(xpiPath),
    path.resolve(hostPath),
    path.resolve(setupPath),
  ];
  for (const a of assets) {
    if (!fs.existsSync(a)) throw new Error(`Missing: ${a}`);
  }

  console.log(`Publishing ${tag} to ${repo}…`);
  await verifyToken(token, repo);
  const release = await getOrCreateRelease(token, repo);

  for (const a of assets) {
    const name = path.basename(a);
    await deleteExistingAsset(token, repo, release.id, name);
    process.stdout.write(`  Uploading ${name}… `);
    await uploadAsset(release.upload_url, token, a);
    console.log('OK');
  }

  console.log(`Release: ${release.html_url}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
