#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const engineDir = path.join(__dirname, '..', 'extension', 'activities', '_runtime', 'engine');
const order = [
  'context.js', 'when.js', 'emit.js', 'change-detection.js',
  'helpers.js', 'fetch.js', 'extract.js', 'evaluate.js',
];

function loadEngine() {
  const sandbox = { window: {}, console, URLSearchParams };
  vm.createContext(sandbox);
  for (const file of order) {
    const code = fs.readFileSync(path.join(engineDir, file), 'utf8');
    vm.runInContext(code, sandbox);
  }
  return sandbox.window.SyncrEngine;
}

function patternToRegex(pattern) {
  const parts = String(pattern).split('*').map(part =>
    part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(`^${parts.join('.*')}$`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const SyncrEngine = loadEngine();
  assert(SyncrEngine.ENGINE_VERSION === '2.0.0', 'engine version');

  const protonDef = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'activities', 'proton-mail', 'scraper.json'), 'utf8',
  ));

  const protonDoc = { querySelector: () => null };
  const protonLoc = {
    href: 'https://mail.proton.me/u/0/inbox',
    origin: 'https://mail.proton.me',
    pathname: '/u/0/inbox',
    hostname: 'mail.proton.me',
    search: '',
    hash: '',
  };

  const protonResult = await SyncrEngine.evaluate(protonDef, protonDoc, protonLoc, {});
  assert(protonResult?.mode === 'browsing', 'proton v1 default browsing');

  const ytDef = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'extension', 'activities', 'youtube', 'scraper.json'), 'utf8',
  ));
  const ytBrowsing = await SyncrEngine.evaluate(ytDef, { querySelector: () => null }, {
    href: 'https://www.youtube.com/feed/subscriptions',
    origin: 'https://www.youtube.com',
    pathname: '/feed/subscriptions',
    hostname: 'www.youtube.com',
    search: '',
    hash: '',
  }, {});
  assert(ytBrowsing?.browsing === true, 'youtube browsing mode');

  const meta = {
    video: {
      title: 'Test Show',
      type: 'show',
      currentEpisode: 'ep1',
      seasons: [{ episodes: [{ episodeId: 'ep1', seq: 1, title: 'Pilot' }] }],
      boxart: [{ url: 'https://example.com/thumb.jpg' }],
    },
  };
  const preview = SyncrEngine.SyncrEngineHelpers.buildPreview(meta, 'https://www.netflix.com/title/1');
  assert(preview?.mode === 'preview' && preview.title === 'Test Show', 'netflix preview helper');

  const origins = ['*://mail.proton.me/*'];
  const url = 'https://mail.proton.me/u/0/inbox';
  assert(patternToRegex(origins[0]).test(url), 'URL pattern matches proton');

  console.log('OK — engine tests passed');
}

main().catch(err => {
  console.error('Engine tests failed:', err.message);
  process.exit(1);
});
