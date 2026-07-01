#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'extension', 'activities');
const errors = [];

/** Keys the popup can show in "Now playing" — at least one required per emit block. */
const DISPLAY_KEYS = ['title', 'context', 'details', 'browsing', 'browsingContext', 'name', 'searchQuery'];

function walkScrapers(dir) {
  const found = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (!fs.statSync(p).isDirectory()) continue;
    const scraper = path.join(p, 'scraper.json');
    if (fs.existsSync(scraper)) found.push(scraper);
  }
  return found;
}

function collectEmitBlocks(data) {
  const emits = [];
  const add = block => { if (block?.emit) emits.push(block.emit); };

  for (const rule of data.rules || []) add(rule);
  for (const profile of data.profiles || []) {
    for (const rule of profile.rules || []) add(rule);
  }
  add(data.default);
  add(data.fallback);
  return emits;
}

function hasDisplayField(emit) {
  if (!emit || typeof emit !== 'object') return false;
  if (DISPLAY_KEYS.some(k => emit[k] != null && emit[k] !== '')) return true;
  if (emit.details != null && emit.state != null) return true;
  return false;
}

function validate(file) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`${file}: invalid JSON — ${e.message}`);
    return;
  }

  const ver = data.version ?? 1;
  if (ver !== 1 && ver !== 2) {
    errors.push(`${file}: unsupported version ${ver}`);
  }

  if (ver >= 2) {
    if (!Array.isArray(data.rules) && !Array.isArray(data.profiles)) {
      errors.push(`${file}: v2 scraper needs rules or profiles`);
    }
    const ruleCount = (data.rules?.length || 0) +
      (data.profiles || []).reduce((n, p) => n + (p.rules?.length || 0), 0);
    if (ruleCount > 64) {
      errors.push(`${file}: too many rules (${ruleCount} > 64)`);
    }
  }

  if (data.pollMs != null && data.pollMs < 1000) {
    errors.push(`${file}: pollMs must be >= 1000`);
  }

  const emits = collectEmitBlocks(data);
  if (!emits.length) {
    errors.push(`${file}: no emit blocks found — add rules/default with emit`);
    return;
  }
  for (let i = 0; i < emits.length; i++) {
    if (!hasDisplayField(emits[i])) {
      errors.push(
        `${file}: emit block #${i + 1} has no popup display field ` +
        `(use title, context, details, browsing, or details+state)`,
      );
    }
  }
}

for (const file of walkScrapers(root)) {
  validate(file);
}

if (errors.length) {
  console.error('Scraper validation failed:\n');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log(`OK — ${walkScrapers(root).length} scraper.json file(s) validated`);
