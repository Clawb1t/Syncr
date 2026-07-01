#!/usr/bin/env node
/**
 * Upload or replace a single asset on an existing GitHub release.
 * Usage: node scripts/upload-release-asset.js <tag> <owner/repo> <filePath>
 */
'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const [tag, repo, filePath] = process.argv.slice(2);
if (!tag || !repo || !filePath) {
  console.error('Usage: node scripts/upload-release-asset.js <tag> <owner/repo> <filePath>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const absPath = path.resolve(filePath);
if (!fs.existsSync(absPath)) {
  console.error(`Missing file: ${absPath}`);
  process.exit(1);
}

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
  const base = uploadUrl.replace(/\{[^}]*\}$/, '');
  return `${base}?name=${encodeURIComponent(fileName)}`;
}

function uploadAsset(uploadUrl, token, assetPath) {
  return new Promise((resolve, reject) => {
    const name = path.basename(assetPath);
    const data = fs.readFileSync(assetPath);
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

async function main() {
  const token = loadEnv();
  const name = path.basename(absPath);

  const res = await apiRequest('GET', `https://api.github.com/repos/${repo}/releases/tags/${tag}`, token);
  if (res.status !== 200) {
    throw new Error(`Release ${tag} not found: HTTP ${res.status}`);
  }

  const release = res.data;
  const existing = (release.assets || []).find((a) => a.name === name);
  if (existing) {
    await apiRequest('DELETE', `https://api.github.com/repos/${repo}/releases/assets/${existing.id}`, token);
  }

  process.stdout.write(`Uploading ${name} to ${tag}… `);
  await uploadAsset(release.upload_url, token, absPath);
  console.log('OK');
  console.log(`Release: ${release.html_url}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
