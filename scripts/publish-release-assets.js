#!/usr/bin/env node
/**
 * Upload one or more assets to an existing GitHub release.
 * Usage: node scripts/publish-release-assets.js <tag> <owner/repo> <file> [file...]
 */
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const [tag, repo, ...assetPaths] = process.argv.slice(2);
if (!tag || !repo || !assetPaths.length) {
  console.error('Usage: node scripts/publish-release-assets.js <tag> <owner/repo> <file> [file...]');
  process.exit(1);
}

const root = path.join(__dirname, '..');

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
  if (!token) throw new Error('GITHUB_TOKEN not found in .env');
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
        let data = Buffer.concat(chunks).toString();
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

async function getReleaseByTag(token, repoSlug) {
  const res = await apiRequest('GET', `https://api.github.com/repos/${repoSlug}/releases/tags/${tag}`, token);
  if (res.status === 200) return res.data;
  throw new Error(`Release ${tag} not found (HTTP ${res.status})`);
}

async function main() {
  const token = loadEnv();
  const files = assetPaths.map((p) => path.resolve(p));
  for (const f of files) {
    if (!fs.existsSync(f)) throw new Error(`Missing: ${f}`);
  }

  console.log(`Uploading to ${repo} release ${tag}…`);
  const release = await getReleaseByTag(token, repo);

  for (const f of files) {
    const name = path.basename(f);
    await deleteExistingAsset(token, repo, release.id, name);
    process.stdout.write(`  Uploading ${name}… `);
    await uploadAsset(release.upload_url, token, f);
    console.log('OK');
  }

  console.log(`Release: ${release.html_url}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
