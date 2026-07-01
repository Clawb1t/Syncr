#!/usr/bin/env node
/** Send a test activity:update to syncr-host via native messaging protocol */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const exe = process.argv[2] || path.join(process.env.LOCALAPPDATA, 'Syncr', 'syncr-host.exe');

function send(msg) {
  const json = JSON.stringify(msg);
  const len = Buffer.byteLength(json, 'utf8');
  const buf = Buffer.allocUnsafe(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4, 'utf8');
  return buf;
}

const cp = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
cp.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });

setTimeout(() => {
  cp.stdin.write(send({
    type: 'activity:update',
    activityId: 'youtube-music',
    data: { browsing: true },
  }));
}, 300);

setTimeout(() => {
  cp.stdin.write(send({
    type: 'activity:update',
    activityId: 'youtube-music',
    data: {
      browsing: false,
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      albumArt: 'https://example.com/art.jpg',
      currentTime: 30,
      duration: 180,
      paused: false,
      pageUrl: 'https://music.youtube.com/watch?v=test',
    },
  }));
}, 1200);

setTimeout(() => {
  cp.stdin.end();
  setTimeout(() => process.exit(stderr.includes('formatPresence') ? 1 : 0), 500);
}, 2500);
