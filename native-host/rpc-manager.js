const DiscordRPC = require('discord-rpc');
const fs         = require('fs');
const path       = require('path');

const LOG_FILE = path.join(__dirname, 'host.log');
function log(msg) {
  const line = `[${new Date().toISOString()}][rpc] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  process.stderr.write(`[RPC] ${msg}\n`);
}

process.on('unhandledRejection', () => {});

/**
 * Manages discord-rpc IPC clients — one per Discord application clientId.
 *
 * We bypass client.setActivity() and call client.request('SET_ACTIVITY')
 * directly so we can pass the `type` field (e.g. 2 = Listening).
 * The discord-rpc library's setActivity() silently strips unknown fields
 * including `type`, which would force everything to show as "Playing a game".
 */
class RPCManager {
  constructor() {
    this._clients    = new Map(); // clientId → { client, ready }
    this._activeId   = null;
    this._lastImage  = new Map(); // clientId → last large_image URL sent
  }

  async _getClient(clientId) {
    const existing = this._clients.get(clientId);
    if (existing?.ready) return existing.client;

    const client = new DiscordRPC.Client({ transport: 'ipc' });
    const entry  = { client, ready: false };
    this._clients.set(clientId, entry);

    client.on('ready', () => {
      entry.ready = true;
      log(`Connected — ${client.user?.username} (${clientId})`);
    });

    client.on('disconnected', () => {
      entry.ready = false;
      this._clients.delete(clientId);
      log(`Disconnected (${clientId})`);
    });

    try {
      await client.login({ clientId });
      return client;
    } catch (err) {
      this._clients.delete(clientId);
      throw new Error(`IPC login failed for ${clientId}: ${err.message}`);
    }
  }

  /**
   * Build the raw Discord activity object from a formatPresence() result.
   * Supports the full activity shape including type, timestamps, assets, buttons.
   */
  _buildActivity(presence) {
    const activity = {
      // type: 2 = Listening, 0 = Playing (default). Passed straight through
      // because the "listening to" label in Discord depends on this field.
      type:     presence.type     ?? 0,
      // name: shown in the compact status bar as "Listening to [name]"
      name:     presence.name     ?? undefined,
      details:  presence.details  ?? undefined,
      state:    presence.state    ?? undefined,
      instance: !!presence.instance,
    };

    // Progress bar — pass as nested object so Discord renders it correctly
    if (presence.timestamps) {
      activity.timestamps = presence.timestamps;
    }

    // Images
    if (presence.assets) {
      activity.assets = presence.assets;
    }

    // Buttons (max 2)
    if (Array.isArray(presence.buttons) && presence.buttons.length) {
      activity.buttons = presence.buttons.slice(0, 2);
    }

    return activity;
  }

  async setActivity(clientId, presence) {
    if (this._activeId && this._activeId !== clientId) {
      await this.clearActivity(this._activeId);
    }
    this._activeId = clientId;

    try {
      const client   = await this._getClient(clientId);
      const activity = this._buildActivity(presence);
      const newImage = activity.assets?.large_image ?? null;
      const oldImage = this._lastImage.get(clientId) ?? null;

      // When large_image changes Discord may serve a stale proxy-cached image
      // for the new activity. A clear → short wait → set forces a fresh load.
      if (oldImage && newImage && oldImage !== newImage) {
        log(`Image changed (${oldImage} → ${newImage}), clearing before reset`);
        await client.request('SET_ACTIVITY', { pid: process.pid, activity: null });
        await new Promise(r => setTimeout(r, 200));
      }
      this._lastImage.set(clientId, newImage);

      // Use request() directly — setActivity() strips `type` and other fields
      log(`SET_ACTIVITY → ${JSON.stringify(activity)}`);
      await client.request('SET_ACTIVITY', {
        pid: process.pid,
        activity,
      });
    } catch (err) {
      log(`setActivity error: ${err.message}`);
    }
  }

  async clearActivity(clientId) {
    const id    = clientId ?? this._activeId;
    if (!id) return;
    const entry = this._clients.get(id);
    if (entry?.ready) {
      try {
        await entry.client.request('SET_ACTIVITY', { pid: process.pid, activity: null });
      } catch {}
    }
    if (id === this._activeId) this._activeId = null;
    this._lastImage.delete(id);
  }

  async destroyAll() {
    for (const { client, ready } of this._clients.values()) {
      if (ready) try { await client.destroy(); } catch {}
    }
    this._clients.clear();
  }
}

module.exports = { RPCManager };
