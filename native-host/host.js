#!/usr/bin/env node
/**
 * Syncr Native Messaging Host
 *
 * Firefox spawns this process automatically via the Native Messaging API.
 * Communicates over stdin/stdout using the 4-byte length-prefix protocol.
 * Connects to Discord via IPC — no OAuth, no client secret required.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { loadActivities, getSyncr } = require('./activity-loader');
const { RPCManager }     = require('./rpc-manager');
const { LOG_FILE }       = require('./paths');

// File log — next to syncr-host.exe (not inside pkg snapshot)
let logStream;
try {
  logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
} catch {
  logStream = null;
}

const activities = loadActivities();
const rpc        = new RPCManager();

// ---------------------------------------------------------------------------
// Outbound native messaging (host → extension)
// ---------------------------------------------------------------------------

function writeMessage(msg) {
  const json = JSON.stringify(msg);
  const len  = Buffer.byteLength(json, 'utf8');
  const buf  = Buffer.allocUnsafe(4 + len);
  buf.writeUInt32LE(len, 0);
  buf.write(json, 4, 'utf8');
  process.stdout.write(buf);
}

// ---------------------------------------------------------------------------
// Native Messaging stdio protocol (4-byte LE length prefix + UTF-8 JSON)
// ---------------------------------------------------------------------------

let buf = Buffer.alloc(0);

process.stdin.on('data', chunk => {
  buf = Buffer.concat([buf, chunk]);

  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;

    const msgBuf = buf.slice(4, 4 + len);
    buf = buf.slice(4 + len);

    let msg;
    try { msg = JSON.parse(msgBuf.toString('utf8')); }
    catch { continue; }

    handleMessage(msg).catch(err => log('error', err.message));
  }
});

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleMessage({ type, activityId, data }) {
  switch (type) {
    case 'host:checkUpdates': {
      const { updateActivities, checkHostUpdate, getActivityStatus, localVersion } = require('./updater');
      const apply = data?.apply !== false;
      const updatedActivities = apply ? await updateActivities(log) : [];

      if (updatedActivities.length > 0) {
        const fresh = loadActivities();
        for (const id of updatedActivities) {
          if (fresh.has(id)) activities.set(id, fresh.get(id));
        }
      }

      const [activityStatus, hostUpdate] = await Promise.all([
        getActivityStatus(),
        checkHostUpdate(log),
      ]);

      writeMessage({
        type: 'host:updateResult',
        updatedActivities,
        activityStatus,
        hostUpdate,
        hostVersion: localVersion(),
      });
      break;
    }

    case 'host:installActivity': {
      const activityId = data?.activityId;
      const { installActivity, checkHostUpdate, getActivityStatus, localVersion } = require('./updater');

      if (!activityId) {
        writeMessage({
          type:  'host:updateResult',
          ok:    false,
          error: 'Missing activityId',
        });
        break;
      }

      try {
        const { updated } = await installActivity(activityId, log);
        if (updated) {
          const fresh = loadActivities();
          if (fresh.has(activityId)) activities.set(activityId, fresh.get(activityId));
        }

        const [activityStatus, hostUpdate] = await Promise.all([
          getActivityStatus(),
          checkHostUpdate(log),
        ]);

        writeMessage({
          type: 'host:updateResult',
          updatedActivities: updated ? [activityId] : [],
          activityStatus,
          hostUpdate,
          hostVersion: localVersion(),
        });
      } catch (err) {
        log('warn', `installActivity ${activityId}: ${err.message}`);
        writeMessage({
          type:  'host:updateResult',
          ok:    false,
          error: err.message,
        });
      }
      break;
    }

    case 'activity:update': {
      const activity = activities.get(activityId);
      if (!activity) { log('warn', `Unknown activityId: ${activityId}`); return; }

      let presence;
      try   { presence = activity.formatPresence(data); }
      catch (err) { log('error', `${activityId}.formatPresence(): ${err.message}`); return; }

      await rpc.setActivity(activity.clientId, presence);
      break;
    }

    case 'activity:clear': {
      const activity = activities.get(activityId);
      await rpc.clearActivity(activity?.clientId);
      break;
    }

    default:
      log('warn', `Unknown message type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

process.stdin.on('end', async () => {
  log('info', 'Extension disconnected — clearing presence.');
  await rpc.clearActivity();
  await rpc.destroyAll();
  process.exit(0);
});

async function shutdown() {
  await rpc.clearActivity();
  await rpc.destroyAll();
  process.exit(0);
}

process.on('SIGINT',  shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', (reason) => { log('error', 'unhandledRejection:', String(reason)); });
process.on('uncaughtException',  (err)    => { log('error', 'uncaughtException:', err.message, err.stack); process.exit(1); });

// ---------------------------------------------------------------------------

function log(level, ...args) {
  const line = `[${new Date().toISOString()}][${level}] ${args.join(' ')}\n`;
  try { logStream?.write(line); } catch {}
  process.stderr.write(`[Syncr:${level}] ${args.join(' ')}\n`);
}

log('info', `Native host started — pid=${process.pid} — ${activities.size} activity(s) loaded.`);

try {
  getSyncr();
  log('info', 'Syncr SDK loaded.');
} catch (err) {
  log('error', `Syncr SDK failed to load: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Background update check — runs 4 s after start so Discord has time to connect
// ---------------------------------------------------------------------------

setTimeout(async () => {
  try {
    handleMessage({ type: 'host:checkUpdates', data: { apply: true } }).catch(err => {
      log('error', `Update check failed: ${err.message}`);
    });
  } catch (err) {
    log('error', `Update check failed: ${err.message}`);
  }
}, 4000);
