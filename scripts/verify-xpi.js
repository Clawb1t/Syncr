#!/usr/bin/env node
/**
 * Verify syncr.xpi is Mozilla-signed and matches the expected version.
 * Usage: node scripts/verify-xpi.js [path] [expectedVersion]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { isXpiSigned, readXpiVersion } = require('./xpi-utils');

const root = path.join(__dirname, '..');
const xpiPath = path.resolve(process.argv[2] || path.join(root, 'dist/syncr.xpi'));
const expected = process.argv[3]
  || JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')).version;

if (!fs.existsSync(xpiPath)) {
  console.error(`Missing: ${xpiPath}`);
  process.exit(1);
}

if (!isXpiSigned(xpiPath)) {
  console.error('XPI is NOT signed by Mozilla — refusing to publish.');
  console.error('Run: node scripts/fetch-signed-xpi.js', expected, '--wait');
  process.exit(1);
}

const version = readXpiVersion(xpiPath);
if (version !== expected) {
  console.error(`XPI version mismatch: file is v${version}, expected v${expected}`);
  process.exit(1);
}

const size = fs.statSync(xpiPath).size;
console.log(`OK: v${version} Mozilla-signed (${size} bytes)`);
