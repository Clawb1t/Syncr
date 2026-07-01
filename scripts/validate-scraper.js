#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'extension', 'activities');
const errors = [];

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
