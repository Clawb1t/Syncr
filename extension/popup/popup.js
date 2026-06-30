'use strict';

// ---------------------------------------------------------------------------
// GitHub source — all remote data comes from here
// ---------------------------------------------------------------------------

const GITHUB_RAW         = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const INSTALL_SCRIPT_URL = `${GITHUB_RAW}/scripts/install-host.ps1`;
const REGISTRY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ---------------------------------------------------------------------------
// Activity registry — tries GitHub first (cached), falls back to local bundle
// ---------------------------------------------------------------------------

let ACTIVITY_META = []; // populated by loadActivityRegistry() on boot

async function loadActivityRegistry() {
  // Try remote registry (GitHub raw) with 1-hour cache
  try {
    const cached = await browser.storage.local.get('_registryCache').catch(() => ({}));
    const cache  = cached._registryCache;

    let ids;

    if (cache && Date.now() - cache.ts < REGISTRY_CACHE_TTL) {
      // Use cached data — still fast on re-open
      ACTIVITY_META = cache.metas;
      return;
    }

    // Fetch fresh from GitHub (5-second timeout)
    const controller = new AbortController();
    const timer      = setTimeout(() => controller.abort(), 5000);

    try {
      const reg = await fetch(`${GITHUB_RAW}/extension/activities/registry.json`,
        { signal: controller.signal }).then(r => r.json());
      clearTimeout(timer);
      ids = reg.activities ?? reg;

      const metas = await Promise.all(
        ids.map(id =>
          fetch(`${GITHUB_RAW}/extension/activities/${id}/metadata.json`)
            .then(r => r.json())
            .then(m => {
              // Attach a resolved logo URL so the popup can use it directly
              if (m && !m.logoUrl && m.logo) {
                m.logoUrl = `${GITHUB_RAW}/extension/activities/${id}/${m.logo}`;
              }
              return m;
            })
            .catch(() => null)
        )
      );

      ACTIVITY_META = metas.filter(Boolean);

      // Cache for next open
      await browser.storage.local.set({ _registryCache: { ts: Date.now(), metas: ACTIVITY_META } })
        .catch(() => {});
      return;
    } catch {
      clearTimeout(timer);
    }
  } catch {}

  // Fall back to local bundle
  try {
    const regUrl = browser.runtime.getURL('activities/registry.json');
    const reg    = await fetch(regUrl).then(r => r.json());
    const ids    = reg.activities ?? reg;

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

// ---------------------------------------------------------------------------
// HTML sanitizer — used wherever dynamic values go into innerHTML
// ---------------------------------------------------------------------------

/** Escape a value so it is safe to embed in HTML attribute or text content */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

const IMAGE_EXTS = ['png', 'svg', 'jpg', 'webp'];
const _imageCache = {};

/**
 * Returns a browser-accessible URL for an activity's logo, or null.
 * First checks metadata.json's `logo` field; then probes
 * activities/{id}/logo.{png,svg,jpg,webp} in order. Results are cached.
 */
function resolveActivityImage(meta) {
  if (meta.id in _imageCache) return _imageCache[meta.id];

  // Remote-loaded metadata already has a full GitHub raw URL
  if (meta.logoUrl) {
    _imageCache[meta.id] = meta.logoUrl;
    return meta.logoUrl;
  }

  // Explicit logo field in metadata.json (local bundle)
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
const updateBanner   = $('update-banner');
const updateBannerTitle = $('update-banner-title');
const updateBannerSub   = $('update-banner-sub');
const updateBannerBtn   = $('update-banner-btn');
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

// Setup wizard
const setupWizard       = $('setup-wizard');
const setupStepWelcome    = $('setup-step-welcome');
const setupStepInstall    = $('setup-step-install');
const setupStepConnecting = $('setup-step-connecting');
const setupStepSuccess    = $('setup-step-success');
const setupBtnNext        = $('setup-btn-next');
const setupBtnDownload    = $('setup-btn-download');
const setupBtnShowDl      = $('setup-btn-show-download');
const setupBtnDone        = $('setup-btn-done');
const setupError          = $('setup-error');

let wizardStep           = 'welcome';
let lastHostDownloadId   = null;
let connectPollTimer     = null;

// Dismiss update banner for the rest of this popup session
let bannerDismissed = false;
$('update-banner-dismiss').addEventListener('click', () => {
  bannerDismissed = true;
  updateBanner.classList.add('hidden');
});

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

function renderUpdateBanner(updateInfo) {
  if (bannerDismissed || !updateInfo) {
    updateBanner.classList.add('hidden');
    return;
  }

  const { hostUpdate, updatedActivities } = updateInfo;

  if (hostUpdate?.available) {
    updateBannerTitle.textContent = `Host Update — v${hostUpdate.latestVersion}`;
    updateBannerSub.textContent   = 'Run the setup wizard to update the native host';
    updateBannerBtn.href          = '#';
    updateBannerBtn.textContent   = 'Update host';
    updateBannerBtn.dataset.action = 'host-update';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (updatedActivities?.length > 0) {
    const names = updatedActivities.join(', ');
    updateBannerTitle.textContent = 'Activities Updated';
    updateBannerSub.textContent   = `${names} — hot-reloaded automatically`;
    updateBannerBtn.href          = 'https://github.com/Clawb1t/Syncr/releases/latest';
    updateBannerBtn.textContent   = 'Changelog';
    delete updateBannerBtn.dataset.action;
    updateBanner.classList.remove('hidden');
    return;
  }

  updateBanner.classList.add('hidden');
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
    npLogo.textContent = '';
    if (imgUrl) {
      const img = document.createElement('img');
      img.src   = imgUrl;
      img.alt   = meta?.name || '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:5px';
      npLogo.appendChild(img);
    } else {
      npLogo.textContent = meta?.icon || '🔌';
    }

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
        ? `<img src="${esc(imgUrl)}" alt="${esc(meta?.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
        : esc(meta?.icon || '🔌');
      const subText = info?.title
        ? (info.sub ? `${esc(info.title)} \u2014 ${esc(info.sub)}` : esc(info.title))
        : 'Live \u00b7 not transmitting';
      return `
        <div class="also-live-row">
          <div class="also-live-logo">${logo}</div>
          <div class="also-live-info">
            <span class="also-live-name">${esc(meta?.name || id)}</span>
            <span class="also-live-sub">${subText}</span>
          </div>
          <button class="switch-btn" data-switch="${esc(id)}">
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
    const msg = ACTIVITY_META.length === 0 ? 'No activities installed.' : 'No activities match your search.';
    activitiesList.innerHTML =
      `<div class="empty-state"><svg viewBox="0 0 24 24" fill="currentColor">` +
      `<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>` +
      `</svg>${esc(msg)}</div>`;
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
    ? `<img src="${esc(imgUrl)}" alt="${esc(meta.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
    : `<span style="font-size:20px;line-height:1">${esc(meta.icon || '🔌')}</span>`;

  return `
    <div class="activity-card ${isActive ? 'active-now' : ''} ${!isEnabled ? 'is-disabled' : ''}" data-id="${esc(meta.id)}">
      <div class="ac-logo">${logoInner}</div>
      <div class="ac-body">
        <div class="ac-name-row">
          <span class="ac-name">${esc(meta.name)}</span>
          <span class="ac-tag">${isActive ? 'Live' : esc(meta.category || '')}</span>
        </div>
        <div class="ac-desc">${esc(meta.description || '')}</div>
      </div>
      <div class="toggle-wrap">
        <label class="toggle" title="${isEnabled ? 'Disable' : 'Enable'} ${esc(meta.name)}">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} data-id="${esc(meta.id)}" />
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Setup wizard
// ---------------------------------------------------------------------------

function showSetupStep(step) {
  wizardStep = step;
  setupStepWelcome.classList.toggle('hidden',    step !== 'welcome');
  setupStepInstall.classList.toggle('hidden',    step !== 'install');
  setupStepConnecting.classList.toggle('hidden', step !== 'connecting');
  setupStepSuccess.classList.toggle('hidden',    step !== 'success');
  setupWizard.classList.remove('hidden');
}

function hideSetupWizard() {
  setupWizard.classList.add('hidden');
  if (connectPollTimer) {
    clearInterval(connectPollTimer);
    connectPollTimer = null;
  }
}

function openSetupWizard(atStep = 'welcome') {
  settingsPanel.classList.add('hidden');
  setupError.classList.add('hidden');
  setupError.textContent = '';
  showSetupStep(atStep === 'install' ? 'install' : atStep);
}

async function shouldShowWizardOnBoot() {
  const stored = await browser.storage.local.get('hostSetupComplete').catch(() => ({}));
  if (!stored.hostSetupComplete) return true;
  return false;
}

async function downloadHostInstaller() {
  setupBtnDownload.disabled = true;
  setupBtnDownload.textContent = 'Downloading…';
  setupError.classList.add('hidden');

  try {
    const id = await browser.downloads.download({
      url: INSTALL_SCRIPT_URL,
      filename: 'Syncr/install-host.ps1',
      saveAs: false,
    });
    lastHostDownloadId = id;
    setupBtnShowDl.classList.remove('hidden');

    // Try to open/run the script (Windows may prompt)
    try {
      await browser.downloads.open(id);
    } catch {
      setupError.textContent = 'Could not auto-open the file. Click "Show in Downloads folder" and run install-host.ps1.';
      setupError.classList.remove('hidden');
    }

    showSetupStep('connecting');
    startConnectPoll();
  } catch (err) {
    setupError.textContent = err.message || 'Download failed. Check your internet connection.';
    setupError.classList.remove('hidden');
  } finally {
    setupBtnDownload.disabled = false;
    setupBtnDownload.textContent = 'Download & Install Host';
  }
}

function startConnectPoll() {
  if (connectPollTimer) clearInterval(connectPollTimer);

  connectPollTimer = setInterval(async () => {
    await browser.runtime.sendMessage({ type: 'host:forceReconnect' }).catch(() => {});
    await syncState({ skipWizardCheck: true });

    if (currentState.connected) {
      clearInterval(connectPollTimer);
      connectPollTimer = null;
      await browser.storage.local.set({ hostSetupComplete: true }).catch(() => {});
      showSetupStep('success');
    }
  }, 1500);
}

setupBtnNext.addEventListener('click', () => showSetupStep('install'));
setupBtnDownload.addEventListener('click', () => downloadHostInstaller());
setupBtnShowDl.addEventListener('click', async () => {
  if (lastHostDownloadId != null) {
    try { await browser.downloads.show(lastHostDownloadId); } catch {}
  }
});
setupBtnDone.addEventListener('click', () => hideSetupWizard());

updateBannerBtn.addEventListener('click', e => {
  if (updateBannerBtn.dataset.action === 'host-update') {
    e.preventDefault();
    openSetupWizard('install');
  }
});

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
  settingsPanel.classList.add('hidden');
  openSetupWizard('install');
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
  openSetupWizard('welcome');
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

searchInput.addEventListener('input', () => renderActivities(searchInput.value));

// ---------------------------------------------------------------------------
// State sync
// ---------------------------------------------------------------------------

async function syncState(opts = {}) {
  try {
    const state = await browser.runtime.sendMessage({ type: 'popup:getState' });
    if (!state) return;
    currentState = state;
    setStatus(state.connected ? 'connected' : 'disconnected', state.connected ? null : state.lastError);
    renderUpdateBanner(state.updateInfo ?? null);
    renderNowPlaying(state.transmittingId, state.liveActivities);
    renderActivities(searchInput.value);

    if (!opts.skipWizardCheck) {
      if (state.connected) {
        await browser.storage.local.set({ hostSetupComplete: true }).catch(() => {});
      } else if (await shouldShowWizardOnBoot()) {
        openSetupWizard('welcome');
      }
    }
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
