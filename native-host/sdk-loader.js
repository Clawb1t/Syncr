#!/usr/bin/env node
'use strict';

// Must use a string literal require — pkg cannot bundle dynamic require paths.
let _syncr = null;

function getSyncr() {
  if (_syncr) return _syncr;

  _syncr = require('./sdk');

  if (!_syncr?.browsing || !_syncr?.presence) {
    throw new Error('Syncr SDK incomplete');
  }

  return _syncr;
}

module.exports = { getSyncr };
