'use strict';

const path = require('path');

// When bundled with pkg, __dirname is inside the read-only snapshot.
// Always read/write next to syncr-host.exe in %LOCALAPPDATA%\Syncr.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const ACTIVITIES_DIR = path.join(BASE_DIR, 'activities');
const LOG_FILE = path.join(BASE_DIR, 'host.log');
const VERSION_FILE = path.join(BASE_DIR, 'version.json');
const STATUS_FILE = path.join(BASE_DIR, 'status.json');

module.exports = { BASE_DIR, ACTIVITIES_DIR, LOG_FILE, VERSION_FILE, STATUS_FILE };
