'use strict';

// ---------------------------------------------------------------------------
// Activity registry — loaded dynamically from activities/registry.json
// and each activity's metadata.json
// ---------------------------------------------------------------------------

let ACTIVITY_META = []; // populated by loadActivityRegistry() on boot

async function loadActivityRegistry() {
  try {
    // Fetch the registry. Currently local; in future this URL can be swapped
    // for a remote source (e.g. GitHub raw) and the rest of the loader stays
    // identical — only per-activity logos/metadata need a CDN prefix.
    const regUrl = browser.runtime.getURL('activities/registry.json');
    const reg    = await fetch(regUrl).then(r => r.json());
    const ids    = reg.activities ?? reg; // support both array and {activities:[]} shapes

    const metas = await Promise.all(
      ids.map(id =>
        fetch(browser.runtime.getURL(`activities/${id}/metadata.json`))
          .then(r => r.json())
          .catch(() => null)
      )
    );

    ACTIVITY_META = metas.filter(Boolean);
  } catch (err) {
    console.error('[Syncr] Failed to load activity registry:', err);
    ACTIVITY_META = [];
  }
}

// ---------------------------------------------------------------------------
// Image resolution
// ---------------------------------------------------------------------------

const IMAGE_EXTS = ['png', 'svg', 'jpg', 'webp'];
const _imageCache = {};

/**
 * Returns a browser-accessible URL for an activity's logo, or null.
 * First checks metadata.json's `logo` field; then probes
 * activities/{id}/logo.{png,svg,jpg,webp} in order. Results are cached.
 */
function resolveActivityImage(meta) {
  if (meta.id in _imageCache) return _imageCache[meta.id];

  // Explicit logo field in metadata.json
  if (meta.logo) {
    const url = browser.runtime.getURL(`activities/${meta.id}/${meta.logo}`);
    _imageCache[meta.id] = url;
    return url;
  }

  // Auto-probe by extension — returns null initially, re-renders when found
  _imageCache[meta.id] = null;

  (async () => {
    for (const ext of IMAGE_EXTS) {
      const url = browser.runtime.getURL(`activities/${meta.id}/logo.${ext}`);
      const ok  = await new Promise(resolve => {
        const img   = new Image();
        img.onload  = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src     = url;
      });
      if (ok) {
        _imageCache[meta.id] = url;
        renderActivities(searchInput?.value || '');
        return;
      }
    }
  })();

  return null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentState       = { connected: false, activeActivityId: null, activeData: null, lastError: null };
let disabledActivities = new Set();

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = id => document.getElementById(id);
const statusDot      = $('status-dot');
const statusLabel    = $('status-label');
const nowPlaying     = $('now-playing');
const npLogo         = $('np-logo');
const npTag          = $('np-activity-tag');
const npTitle        = $('np-title');
const alsoLive       = $('also-live');
const activitiesList = $('activities-list');
const searchInput    = $('search-input');
const settingsPanel  = $('settings-panel');
const footer         = $('footer');
const brandIcon      = document.querySelector('.brand-icon');

// ---------------------------------------------------------------------------
// Toggle persistence
// ---------------------------------------------------------------------------

async function loadDisabled() {
  const stored = await browser.storage.local.get('disabledActivities').catch(() => ({}));
  disabledActivities = new Set(stored.disabledActivities || []);
}

async function saveDisabled() {
  await browser.storage.local.set({ disabledActivities: [...disabledActivities] }).catch(() => {});
}

async function setActivityEnabled(id, enabled) {
  if (enabled) {
    disabledActivities.delete(id);
  } else {
    disabledActivities.add(id);
    if (currentState.activeActivityId === id) {
      await browser.runtime.sendMessage({ type: 'activity:clear', activityId: id });
    }
  }
  await saveDisabled();
  await browser.runtime.sendMessage({ type: 'activity:setEnabled', activityId: id, enabled });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function setStatus(state, errorMsg) {
  statusDot.className = `status-dot ${state}`;
  const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting…' };
  statusLabel.textContent = labels[state] || state;
  footer.classList.toggle('hidden-footer', state === 'connected');
  const errEl = $('footer-error');
  if (errEl) errEl.textContent = errorMsg ? `Error: ${errorMsg}` : '';
}

/**
 * Extract a human-readable title + optional subtitle from raw activity data.
 * Both content scripts send `data.title` as the primary field.
 * YouTube Music adds `data.artist`; YouTube adds `data.channelName`.
 */
function getActivityTitle(data) {
  if (!data) return null;
  if (data.browsing) return { title: 'Browsing…', sub: null };
  if (!data.title) return null;
  const sub = data.artist      ? `by ${data.artist}`
            : data.channelName ? `by ${data.channelName}`
            : null;
  return { title: data.title, sub };
}

function renderNowPlaying(transmittingId, liveActivitiesObj) {
  // ── Transmitting strip ────────────────────────────────────────────
  const isTransmitting = !!(transmittingId && !disabledActivities.has(transmittingId));
  brandIcon.classList.toggle('is-transmitting', isTransmitting);

  if (!isTransmitting) {
    nowPlaying.classList.add('hidden');
  } else {
    const meta    = ACTIVITY_META.find(a => a.id === transmittingId);
    const imgUrl  = meta ? resolveActivityImage(meta) : null;
    const info    = getActivityTitle(liveActivitiesObj?.[transmittingId]);

    nowPlaying.classList.remove('hidden');
    npTag.textContent = meta?.name || transmittingId;
    npLogo.innerHTML  = imgUrl
      ? `<img src="${imgUrl}" alt="${meta?.name || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
      : (meta?.icon || '🔌');

    if (info?.title) {
      npTitle.textContent = info.sub ? `${info.title} - ${info.sub}` : info.title;
      npTitle.classList.remove('hidden');
    } else {
      npTitle.textContent = '';
      npTitle.classList.add('hidden');
    }
  }

  // ── Also-live section ─────────────────────────────────────────────
  const otherIds = Object.keys(liveActivitiesObj || {})
    .filter(id => id !== transmittingId && !disabledActivities.has(id));

  if (otherIds.length === 0) {
    alsoLive.classList.add('hidden');
    alsoLive.innerHTML = '';
    return;
  }

  // Swap icon — two opposing horizontal arrows
  const swapIcon = `<svg viewBox="0 0 20 20" fill="currentColor">
    <path d="M13 4.5a.75.75 0 01.75.75V14h1.75a.25.25 0 01.177.427l-3.25 3.25a.25.25 0 01-.354 0l-3.25-3.25A.25.25 0 019.5 14h1.75V5.25A.75.75 0 0113 4.5zM7 15.5a.75.75 0 01-.75-.75V6H4.5a.25.25 0 01-.177-.427l3.25-3.25a.25.25 0 01.354 0l3.25 3.25A.25.25 0 0110.5 6H8.75v8.75A.75.75 0 017 15.5z"/>
  </svg>`;

  alsoLive.classList.remove('hidden');
  alsoLive.innerHTML =
    `<div class="also-live-header">Also active</div>` +
    otherIds.map(id => {
      const meta   = ACTIVITY_META.find(a => a.id === id);
      const imgUrl = meta ? resolveActivityImage(meta) : null;
      const info   = getActivityTitle(liveActivitiesObj?.[id]);
      const logo   = imgUrl
        ? `<img src="${imgUrl}" alt="${meta?.name || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
        : (meta?.icon || '🔌');
      const subLine = info?.title
        ? `<span class="also-live-sub">${info.sub ? `${info.title} - ${info.sub}` : info.title}</span>`
        : `<span class="also-live-sub">Live · not transmitting</span>`;
      return `
        <div class="also-live-row">
          <div class="also-live-logo">${logo}</div>
          <div class="also-live-info">
            <span class="also-live-name">${meta?.name || id}</span>
            ${subLine}
          </div>
          <button class="switch-btn" data-switch="${id}">
            ${swapIcon}
            Switch
          </button>
        </div>`;
    }).join('');

  alsoLive.querySelectorAll('.switch-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.switch;
      await browser.runtime.sendMessage({ type: 'activity:setPriority', activityId: id });
      await syncState();
    });
  });
}

function renderActivities(filter = '') {
  const q        = filter.toLowerCase().trim();
  const filtered = ACTIVITY_META.filter(a =>
    !q || a.name.toLowerCase().includes(q) || (a.category || '').toLowerCase().includes(q)
  );

  if (filtered.length === 0) {
    activitiesList.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
        ${ACTIVITY_META.length === 0 ? 'No activities installed.' : 'No activities match your search.'}
      </div>`;
    return;
  }

  activitiesList.innerHTML = filtered.map(a => buildCard(a)).join('');

  activitiesList.querySelectorAll('.toggle input').forEach(input => {
    input.addEventListener('change', async e => {
      const id      = e.target.dataset.id;
      const enabled = e.target.checked;
      const card    = activitiesList.querySelector(`.activity-card[data-id="${id}"]`);
      if (card) card.classList.toggle('is-disabled', !enabled);
      await setActivityEnabled(id, enabled);
      if (!enabled) renderNowPlaying(null, null);
    });
  });
}

function buildCard(meta) {
  const isActive  = !!(currentState.liveActivities?.[meta.id]);
  const isEnabled = !disabledActivities.has(meta.id);
  const imgUrl    = resolveActivityImage(meta);

  const logoInner = imgUrl
    ? `<img src="${imgUrl}" alt="${meta.name}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
    : `<span style="font-size:20px;line-height:1">${meta.icon || '🔌'}</span>`;

  return `
    <div class="activity-card ${isActive ? 'active-now' : ''} ${!isEnabled ? 'is-disabled' : ''}" data-id="${meta.id}">
      <div class="ac-logo">${logoInner}</div>
      <div class="ac-body">
        <div class="ac-name-row">
          <span class="ac-name">${meta.name}</span>
          <span class="ac-tag">${isActive ? 'Live' : (meta.category || '')}</span>
        </div>
        <div class="ac-desc">${meta.description || ''}</div>
      </div>
      <div class="toggle-wrap">
        <label class="toggle" title="${isEnabled ? 'Disable' : 'Enable'} ${meta.name}">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} data-id="${meta.id}" />
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------

$('btn-settings').addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
  $('s-host-status').textContent = currentState.connected ? 'Connected' : 'Not connected';
});

$('settings-back').addEventListener('click', () => settingsPanel.classList.add('hidden'));

$('open-setup').addEventListener('click', e => {
  e.preventDefault();
  browser.tabs.create({ url: 'http://127.0.0.1:47820' });
});

async function doReconnect(btn) {
  const orig = btn?.textContent;
  if (btn) { btn.textContent = 'Reconnecting…'; btn.disabled = true; }
  try {
    await browser.runtime.sendMessage({ type: 'host:forceReconnect' });
  } catch {
    browser.runtime.reload();
    return;
  }
  await new Promise(r => setTimeout(r, 1200));
  await syncState();
  if (btn) { btn.textContent = orig; btn.disabled = false; }
}

$('btn-reload').addEventListener('click', () => doReconnect($('btn-reload')));

$('footer-reconnect').addEventListener('click', e => {
  e.preventDefault();
  doReconnect(null);
});

$('footer-setup').addEventListener('click', e => {
  e.preventDefault();
  browser.tabs.create({ url: 'http://127.0.0.1:47820' });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

searchInput.addEventListener('input', () => renderActivities(searchInput.value));

// ---------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------

async function syncState() {
  try {
    const state = await browser.runtime.sendMessage({ type: 'popup:getState' });
    if (!state) return;
    currentState = state;
    setStatus(state.connected ? 'connected' : 'disconnected', state.connected ? null : state.lastError);
    renderNowPlaying(state.transmittingId, state.liveActivities);
    renderActivities(searchInput.value);
  } catch {
    setStatus('disconnected');
  }
}

// ---------------------------------------------------------------------------
// Boot — load registry first, then render
// ---------------------------------------------------------------------------

setStatus('connecting');

(async () => {
  await Promise.all([loadActivityRegistry(), loadDisabled()]);
  renderActivities();
  await syncState();
})();

const pollInterval = setInterval(syncState, 1000);
window.addEventListener('unload', () => clearInterval(pollInterval));
