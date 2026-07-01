'use strict';

const NATIVE_HOST  = 'syncr';
const RECONNECT_MS = 5000;
const GITHUB_RAW   = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const REMOTE_INDEX_MS = 5 * 60 * 1000;

let port               = null;
let reconnectTimer     = null;
let disabledActivities = new Set();
let remoteActivityIndex = [];
let remoteIndexLoadedAt = 0;

// ---------------------------------------------------------------------------
// Remote activity index (GitHub registry + metadata, PreMiD-style resolution)
// ---------------------------------------------------------------------------

function patternToRegex(pattern) {
  const parts = String(pattern).split('*').map(part =>
    part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(`^${parts.join('.*')}$`);
}

function urlMatchesPatterns(url, patterns) {
  if (!url || !patterns?.length) return false;
  return patterns.some(pat => patternToRegex(pat).test(url));
}

function metaToIndexEntry(meta) {
  if (!meta || meta.scraper !== 'remote') return null;
  const origins = meta.origins?.length ? meta.origins : (meta.urlPattern ? [meta.urlPattern] : []);
  if (!origins.length) return null;
  return {
    id:               meta.id,
    origins,
    fetchOrigins:     meta.fetchOrigins || [],
    privacy:          !!meta.privacy,
    minEngineVersion: meta.minEngineVersion || meta.minExtensionVersion || '2.0.0',
  };
}

async function refreshRemoteActivityIndex(force = false) {
  if (!force && remoteIndexLoadedAt && Date.now() - remoteIndexLoadedAt < REMOTE_INDEX_MS) {
    return remoteActivityIndex;
  }

  const bundled = await loadBundledRemoteIndex();
  const byId = new Map(bundled.map(e => [e.id, e]));

  try {
    const reg = await fetch(`${GITHUB_RAW}/extension/activities/registry.json`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);
    const ids = reg?.activities ?? [];

    for (const id of ids) {
      let meta = null;
      try {
        meta = await fetch(`${GITHUB_RAW}/extension/activities/${id}/metadata.json`, { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null);
      } catch {}
      if (!meta || meta.scraper !== 'remote') continue;
      const entry = metaToIndexEntry(meta);
      if (!entry) continue;
      byId.set(id, entry);
    }

    remoteActivityIndex = [...byId.values()];
    remoteIndexLoadedAt = Date.now();
    browser.storage.local.set({ syncrRemoteIndex: remoteActivityIndex, syncrRemoteIndexTs: remoteIndexLoadedAt }).catch(() => {});
  } catch {
    if (byId.size) {
      remoteActivityIndex = [...byId.values()];
      remoteIndexLoadedAt = Date.now();
    } else {
      const cached = await browser.storage.local.get(['syncrRemoteIndex', 'syncrRemoteIndexTs']).catch(() => ({}));
      if (cached.syncrRemoteIndex) {
        remoteActivityIndex = cached.syncrRemoteIndex;
        remoteIndexLoadedAt = cached.syncrRemoteIndexTs || 0;
      }
    }
  }

  return remoteActivityIndex;
}

async function loadBundledRemoteIndex() {
  try {
    const reg = await fetch(browser.runtime.getURL('activities/registry.json')).then(r => r.ok ? r.json() : null);
    const ids = reg?.activities ?? [];
    const index = [];

    for (const id of ids) {
      let meta = null;
      try {
        meta = await fetch(browser.runtime.getURL(`activities/${id}/metadata.json`))
          .then(r => r.ok ? r.json() : null);
      } catch {}
      if (!meta || meta.scraper !== 'remote') continue;
      const entry = metaToIndexEntry(meta);
      if (!entry) continue;
      index.push(entry);
    }

    return index;
  } catch {
    return [];
  }
}

function resolveRemoteActivityForUrl(url) {
  return remoteActivityIndex.filter(entry => urlMatchesPatterns(url, entry.origins));
}

function findRemoteEntryForUrl(url) {
  const matches = resolveRemoteActivityForUrl(url);
  return matches[0] || null;
}

refreshRemoteActivityIndex(true);
setInterval(() => refreshRemoteActivityIndex(true), REMOTE_INDEX_MS);

// ---------------------------------------------------------------------------
// Multi-activity tracking
// ---------------------------------------------------------------------------

// All currently live activities: id → { data, tabId, origin, startedAt }
const liveActivities = new Map();

// Which activity is showing on Discord right now
let transmittingId = null;

// User's saved priority preference (null = automatic)
let preferredActivityId = null;

// Load persisted settings on startup
browser.storage.local.get(['disabledActivities', 'preferredActivityId']).then(stored => {
  disabledActivities    = new Set(stored.disabledActivities    || []);
  preferredActivityId   = stored.preferredActivityId           || null;
}).catch(() => {});

// ---------------------------------------------------------------------------
// Priority logic
// ---------------------------------------------------------------------------

/**
 * Determine which live activity should be transmitting.
 * Priority order:
 *   1. User's saved preferred activity (if it's live)
 *   2. The currently transmitting activity (stay stable)
 *   3. The activity that went live first
 */
function pickTransmitting() {
  if (liveActivities.size === 0) return null;

  if (preferredActivityId && liveActivities.has(preferredActivityId)) {
    return preferredActivityId;
  }

  if (transmittingId && liveActivities.has(transmittingId)) {
    return transmittingId;
  }

  // Fall back to oldest live activity
  let chosen = null, oldest = Infinity;
  for (const [id, info] of liveActivities) {
    if (info.startedAt < oldest) { oldest = info.startedAt; chosen = id; }
  }
  return chosen;
}

/** Send the transmitting activity's latest data to the native host. */
function flushTransmitting() {
  if (!transmittingId || !liveActivities.has(transmittingId)) return;
  send({
    type:       'activity:update',
    activityId: transmittingId,
    data:       liveActivities.get(transmittingId).data,
  });
}

// ---------------------------------------------------------------------------
// State exposed to the popup
// ---------------------------------------------------------------------------

const connState = { connected: false, lastError: null, updateInfo: null };
let pendingUpdateCheck = null;

function buildPopupState() {
  const live = {};
  for (const [id, info] of liveActivities) live[id] = info.data;
  return {
    connected:      connState.connected,
    lastError:      connState.lastError,
    updateInfo:     connState.updateInfo,
    transmittingId,
    preferredId:    preferredActivityId,
    liveActivities: live,
    // Legacy aliases so old popup code paths still work during transition
    activeActivityId: transmittingId,
    activeData:       transmittingId ? liveActivities.get(transmittingId)?.data ?? null : null,
  };
}

// ---------------------------------------------------------------------------
// Native host connection
// ---------------------------------------------------------------------------

function connect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  try {
    port = browser.runtime.connectNative(NATIVE_HOST);
  } catch (err) {
    connState.connected = false;
    connState.lastError = err.message;
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
    return;
  }

  connState.connected = true;
  connState.lastError = null;

  port.onMessage.addListener(msg => {
    if (!msg?.type) return;
    if (msg.type === 'host:updateResult') {
      if (msg.ok === false) {
        if (pendingUpdateCheck) {
          pendingUpdateCheck.resolve({ ok: false, error: msg.error || 'Host update failed' });
          pendingUpdateCheck = null;
        }
        return;
      }
      connState.updateInfo = {
        updatedActivities: msg.updatedActivities ?? [],
        activityStatus:    msg.activityStatus ?? [],
        hostUpdate:        msg.hostUpdate ?? null,
        hostVersion:       msg.hostVersion ?? null,
        receivedAt:        Date.now(),
      };
      if (pendingUpdateCheck) {
        pendingUpdateCheck.resolve({ ok: true, ...connState.updateInfo });
        pendingUpdateCheck = null;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    const err = browser.runtime.lastError;
    connState.lastError = err?.message || 'Unknown disconnect';
    port = null;
    connState.connected = false;
    reconnectTimer = setTimeout(connect, RECONNECT_MS);
  });
}

function forceReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (port) { try { port.disconnect(); } catch {} port = null; }
  connState.connected = false;
  liveActivities.clear();
  transmittingId = null;
  reconnectTimer = setTimeout(connect, 800);
}

function send(msg) {
  if (port) { try { port.postMessage(msg); } catch {} }
}

// ---------------------------------------------------------------------------
// Clear helpers
// ---------------------------------------------------------------------------

function clearActivity(id) {
  if (!liveActivities.has(id)) return;
  liveActivities.delete(id);

  const wasTransmitting = (id === transmittingId);
  if (wasTransmitting) {
    // Send clear to native host for this activity's client
    send({ type: 'activity:clear', activityId: id });
    transmittingId = null;

    // Promote the next best live activity
    const next = pickTransmitting();
    if (next) {
      transmittingId = next;
      flushTransmitting();
    }
  }
}

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg?.type) return;

  if (msg.type === 'popup:getState') {
    sendResponse(buildPopupState());
    return true;
  }

  if (msg.type === 'activity:resolveForUrl') {
    refreshRemoteActivityIndex()
      .then(() => {
        const entry = findRemoteEntryForUrl(msg.url || '');
        sendResponse({
          id:               entry?.id || null,
          ids:              resolveRemoteActivityForUrl(msg.url || '').map(e => e.id),
          ready:            true,
          fetchOrigins:     entry?.fetchOrigins || [],
          privacy:          entry?.privacy || false,
          minEngineVersion: entry?.minEngineVersion || '2.0.0',
        });
      })
      .catch(() => sendResponse({ id: null, ids: [], ready: false }));
    return true;
  }

  if (msg.type === 'activity:isEnabled') {
    sendResponse({ enabled: !disabledActivities.has(msg.activityId) });
    return true;
  }

  if (msg.type === 'activity:update') {
    if (disabledActivities.has(msg.activityId)) return;

    const tabId = sender.tab?.id ?? null;
    let origin  = null;
    try { origin = new URL(sender.tab?.url || '').origin; } catch {}

    const existing = liveActivities.get(msg.activityId);
    liveActivities.set(msg.activityId, {
      data:      { ...msg.data, timestamp: Date.now() },
      tabId,
      origin,
      startedAt: existing?.startedAt ?? Date.now(),
    });

    // Decide who should transmit after this update
    const next = pickTransmitting();
    if (next !== transmittingId) {
      // Transmitting activity changed — clear old one if different client
      if (transmittingId) send({ type: 'activity:clear', activityId: transmittingId });
      transmittingId = next;
    }

    // Only push to Discord if this is the transmitting activity
    if (msg.activityId === transmittingId) {
      flushTransmitting();
    }
    return;
  }

  if (msg.type === 'activity:clear') {
    clearActivity(msg.activityId);
    return;
  }

  if (msg.type === 'host:forceReconnect') {
    forceReconnect();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'host:checkUpdates') {
    if (!port || !connState.connected) {
      sendResponse({ ok: false, error: 'Native host not connected' });
      return true;
    }

    let responded = false;
    const respond = data => {
      if (responded) return;
      responded = true;
      sendResponse(data);
    };

    const timeout = setTimeout(() => {
      if (pendingUpdateCheck) {
        pendingUpdateCheck = null;
        respond({ ok: false, error: 'Update check timed out' });
      }
    }, 45000);

    pendingUpdateCheck = {
      resolve(info) {
        clearTimeout(timeout);
        respond(info);
      },
    };

    send({ type: 'host:checkUpdates', data: { apply: msg.apply !== false } });
    return true;
  }

  if (msg.type === 'host:installActivity') {
    if (!port || !connState.connected) {
      sendResponse({ ok: false, error: 'Native host not connected' });
      return true;
    }

    const activityId = msg.activityId;
    if (!activityId) {
      sendResponse({ ok: false, error: 'Missing activityId' });
      return true;
    }

    let responded = false;
    const respond = data => {
      if (responded) return;
      responded = true;
      sendResponse(data);
    };

    let phase = 'install';

    const timeout = setTimeout(() => {
      if (responded || !pendingUpdateCheck) return;
      if (phase === 'install') {
        phase = 'check';
        send({ type: 'host:checkUpdates', data: { apply: true } });
      } else {
        pendingUpdateCheck = null;
        respond({ ok: false, error: 'Install timed out' });
      }
    }, 6000);

    pendingUpdateCheck = {
      resolve(info) {
        clearTimeout(timeout);
        respond(info);
      },
    };

    send({ type: 'host:installActivity', data: { activityId } });
    return true;
  }

  if (msg.type === 'activity:setEnabled') {
    if (msg.enabled) {
      disabledActivities.delete(msg.activityId);
    } else {
      disabledActivities.add(msg.activityId);
      clearActivity(msg.activityId);
    }
    browser.storage.local.set({ disabledActivities: [...disabledActivities] }).catch(() => {});
    return;
  }

  // Popup switched the preferred transmitting activity
  if (msg.type === 'activity:setPriority') {
    preferredActivityId = msg.activityId;
    browser.storage.local.set({ preferredActivityId }).catch(() => {});

    const next = pickTransmitting();
    if (next && next !== transmittingId) {
      if (transmittingId) send({ type: 'activity:clear', activityId: transmittingId });
      transmittingId = next;
      flushTransmitting();
    }
    sendResponse({ ok: true });
    return true;
  }
});

// ---------------------------------------------------------------------------
// Tab lifecycle — only clear when the ACTIVITY tab closes or leaves its origin
// ---------------------------------------------------------------------------

browser.tabs.onRemoved.addListener(tabId => {
  for (const [id, info] of liveActivities) {
    if (info.tabId === tabId) clearActivity(id);
  }
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return;
  for (const [id, info] of liveActivities) {
    if (info.tabId !== tabId) continue;
    try {
      if (new URL(changeInfo.url).origin !== info.origin) clearActivity(id);
    } catch { clearActivity(id); }
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

connect();
