#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bgPath = path.join(__dirname, '..', 'extension', 'background', 'background.js');
let code = fs.readFileSync(bgPath, 'utf8');
const fnBlock = code.match(/function patternToRegex[\s\S]*?function findRemoteEntryForUrl[\s\S]*?return matches\[0\] \|\| null;\n}/);
if (!fnBlock) {
  console.error('Could not extract pattern helpers from background.js');
  process.exit(1);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fnBlock[0] + '\nthis.test = findRemoteEntryForUrl;', sandbox);

const activitiesDir = path.join(__dirname, '..', 'extension', 'activities');
const cases = [
  { id: 'proton-mail', url: 'https://mail.proton.me/u/0/inbox' },
  { id: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
  { id: 'youtube-music', url: 'https://music.youtube.com/' },
  { id: 'reddit', url: 'https://www.reddit.com/r/test/comments/abc/post' },
  { id: 'netflix', url: 'https://www.netflix.com/browse' },
];

let remoteActivityIndex = [];

for (const dir of fs.readdirSync(activitiesDir)) {
  const metaPath = path.join(activitiesDir, dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) continue;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.scraper !== 'remote') continue;
  const origins = meta.origins?.length ? meta.origins : (meta.urlPattern ? [meta.urlPattern] : []);
  remoteActivityIndex.push({
    id: meta.id,
    origins,
    fetchOrigins: meta.fetchOrigins || [],
    minEngineVersion: meta.minEngineVersion || '2.0.0',
  });
}

sandbox.remoteActivityIndex = remoteActivityIndex;

let failed = 0;
for (const { id, url } of cases) {
  const entry = sandbox.test(url);
  if (!entry || entry.id !== id) {
    console.error(`FAIL ${id} @ ${url} => ${entry?.id || 'null'}`);
    failed++;
  } else {
    console.log(`OK   ${id}`);
  }
}

process.exit(failed ? 1 : 0);
