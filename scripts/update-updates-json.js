#!/usr/bin/env node
/**
 * Patch updates.json with a new signed XPI entry.
 * Usage: node scripts/update-updates-json.js <version> <path-to-syncr.xpi> [repo]
 */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const [version, xpiPath, repo = 'Clawb1t/Syncr'] = process.argv.slice(2);
if (!version || !xpiPath) {
  console.error('Usage: node scripts/update-updates-json.js <version> <xpi-path> [owner/repo]');
  process.exit(1);
}

const absXpi = path.resolve(xpiPath);
if (!fs.existsSync(absXpi)) {
  console.error(`XPI not found: ${absXpi}`);
  process.exit(1);
}

const hash = crypto.createHash('sha256').update(fs.readFileSync(absXpi)).digest('hex');
const updatesPath = path.join(__dirname, '..', 'updates.json');
const data = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
const addonId = 'syncr@clawb1t';
const updates = (data.addons[addonId].updates || []).filter(u => u.version !== version);

updates.unshift({
  version,
  update_link: `https://github.com/${repo}/releases/download/v${version}/syncr.xpi`,
  update_hash: `sha256:${hash}`,
});

data.addons[addonId].updates = updates;
fs.writeFileSync(updatesPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

console.log(`updates.json → v${version}`);
console.log(`  sha256:${hash}`);
