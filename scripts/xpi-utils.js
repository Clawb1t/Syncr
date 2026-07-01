#!/usr/bin/env node
/**
 * Read manifest.version from an XPI (handles compressed zip entries).
 */
'use strict';

const AdmZip = require('adm-zip');

function readXpiVersion(xpiPath) {
  const zip = new AdmZip(xpiPath);
  const entry = zip.getEntry('manifest.json');
  if (!entry) return null;
  const manifest = JSON.parse(entry.getData().toString('utf8'));
  return manifest.version ?? null;
}

function isXpiSigned(xpiPath) {
  const fs = require('fs');
  return fs.readFileSync(xpiPath).includes(Buffer.from('META-INF/mozilla.rsa'));
}

module.exports = { readXpiVersion, isXpiSigned };
