'use strict';

const NATIVE_HOST  = 'syncr';
const RECONNECT_MS = 5000;

let port               = null;
let reconnectTimer     = null;
let disabledActivities = new Set();

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

const connState = { connected: false, lastError: null };

function buildPopupState() {
  const live = {};
  for (const [id, info] of liveActivities) live[id] = info.data;
  return {
    connected:      connState.connected,
    lastError:      connState.lastError,
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
