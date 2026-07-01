'use strict';

// ---------------------------------------------------------------------------
// GitHub source — all remote data comes from here
// ---------------------------------------------------------------------------

const GITHUB_RAW         = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const GITHUB_API         = 'https://api.github.com/repos/Clawb1t/Syncr';
const RELEASES_URL       = 'https://github.com/Clawb1t/Syncr/releases/latest';
const REGISTRY_CACHE_TTL = 5 * 60 * 1000; // soft cache — always revalidates in background
const EXT_VERSION        = browser.runtime.getManifest().version;
let ENGINE_VERSION       = '2.0.0';
const DYNAMIC_LOADER_VER = '1.0.13';

async function loadEngineVersion() {
  try {
    const data = await fetch(browser.runtime.getURL('engine-version.json'), { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);
    if (data?.engineVersion) ENGINE_VERSION = data.engineVersion;
  } catch {}
  return ENGINE_VERSION;
}

let BUNDLED_ACTIVITY_IDS = [];
let HOST_ACTIVITY_STATUS   = [];

function semverGt(a, b) {
  if (!a || !b) return false;
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function semverGte(a, b) {
  if (!a || !b) return false;
  return !semverGt(b, a);
}

async function fetchRemoteUpdateInfo() {
  const [manifest, hostVer, release] = await Promise.all([
    fetch(`${GITHUB_RAW}/extension/manifest.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${GITHUB_RAW}/native-host/version.json`).then(r => r.ok ? r.json() : null).catch(() => null),
    fetch(`${GITHUB_API}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then(r => r.ok ? r.json() : null).catch(() => null),
  ]);

  const assets = release?.assets ?? [];
  const findAsset = pred => assets.find(pred)?.browser_download_url ?? null;

  return {
    extensionVersion: manifest?.version ?? null,
    hostVersion:      hostVer?.version ?? null,
    releaseTag:       release?.tag_name?.replace(/^v/, '') ?? null,
    downloads: {
      xpi:   findAsset(a => a.name === 'syncr.xpi'),
      host:  findAsset(a => a.name === 'syncr-host.exe'),
      setup: findAsset(a => /^Syncr-Setup/i.test(a.name) && a.name.endsWith('.exe')),
    },
  };
}

// ---------------------------------------------------------------------------
// Activity registry — tries GitHub first (cached), falls back to local bundle
// ---------------------------------------------------------------------------

let ACTIVITY_META = []; // populated by loadActivityRegistry() on boot

async function loadBundledRegistryIds() {
  try {
    const reg = await fetch(browser.runtime.getURL('activities/registry.json')).then(r => r.json());
    return reg.activities ?? [];
  } catch {
    return [];
  }
}

async function fetchRemoteRegistryIds() {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), 8000);
  try {
    const reg = await fetch(`${GITHUB_RAW}/extension/activities/registry.json`,
      { signal: controller.signal, cache: 'no-store' }).then(r => r.ok ? r.json() : null);
    clearTimeout(timer);
    return reg?.activities ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function fetchActivityMeta(id) {
  try {
    const m = await fetch(`${GITHUB_RAW}/extension/activities/${id}/metadata.json`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);
    if (m) {
      if (m.logo && !m.logoUrl) {
        m.logoUrl = `${GITHUB_RAW}/extension/activities/${id}/${m.logo}`;
      }
      return m;
    }
  } catch {}

  try {
    return await fetch(browser.runtime.getURL(`activities/${id}/metadata.json`)).then(r => r.json());
  } catch {
    return null;
  }
}

function supportsDynamicLoader() {
  return semverGte(EXT_VERSION, DYNAMIC_LOADER_VER);
}

function getActivityOrigins(meta) {
  if (meta?.origins?.length) return meta.origins;
  if (meta?.urlPattern) return [meta.urlPattern];
  return [];
}

function isRemoteActivity(meta) {
  return meta?.scraper === 'remote';
}

function mergeRegistryIds(remoteIds, bundledIds) {
  return [...new Set([...(remoteIds ?? []), ...bundledIds])];
}

function enrichActivityMeta(meta, bundledIds, hostStatus, remoteExtVersion) {
  const host       = (hostStatus ?? []).find(s => s.id === meta.id);
  const inBundle   = bundledIds.includes(meta.id);
  const minEngine  = meta.minEngineVersion || meta.minExtensionVersion || '2.0.0';
  const isRemote   = meta.scraper === 'remote';
  const hostReady  = !!(host?.installed && host?.upToDate);
  const hostKnown  = hostStatus?.length > 0;

  const extOk = semverGte(ENGINE_VERSION, minEngine);

  let lockReason = null;
  let lockAction = null;

  if (!extOk) {
    const need = semverGt(minEngine, ENGINE_VERSION) ? minEngine : (remoteExtVersion || 'latest');
    lockReason = `Requires engine v${need}`;
    lockAction = 'extension';
  } else if (hostKnown && !hostReady) {
    lockReason = host?.installed ? 'Host activity update available' : 'Run Check for updates in Updates';
    lockAction = 'host';
  }

  return {
    ...meta,
    _ready:           extOk && (!hostKnown || hostReady),
    _extensionReady:  extOk,
    _hostReady:       hostReady,
    _hostKnown:       hostKnown,
    _isRemote:        isRemote,
    _lockReason:      lockReason,
    _lockAction:      lockAction,
    _hasPermission:   true,
  };
}

async function attachPermissionFlags(metas) {
  return metas;
}

function enrichAllMetas(metas, bundledIds, hostStatus, remoteExtVersion) {
  return metas
    .filter(Boolean)
    .map(m => enrichActivityMeta(m, bundledIds, hostStatus, remoteExtVersion));
}

async function fetchRegistryMetas(allIds, bundledIds) {
  const metas = await Promise.all(allIds.map(id => fetchActivityMeta(id)));
  const enriched = enrichAllMetas(metas, bundledIds, HOST_ACTIVITY_STATUS, lastRemoteUpdateInfo?.extensionVersion);
  return attachPermissionFlags(enriched);
}

async function saveRegistryCache(metas, allIds) {
  await browser.storage.local.set({
    _registryCache: {
      ts:         Date.now(),
      extVersion: EXT_VERSION,
      engineVersion: ENGINE_VERSION,
      ids:        allIds,
      metas,
    },
  }).catch(() => {});
}

async function loadActivityRegistry({ background = false } = {}) {
  const bundledIds = await loadBundledRegistryIds();
  BUNDLED_ACTIVITY_IDS = bundledIds;

  const cached = await browser.storage.local.get('_registryCache').catch(() => ({}));
  const cache  = cached._registryCache;

  const cacheValid = cache
    && cache.extVersion === EXT_VERSION
    && cache.engineVersion === ENGINE_VERSION
    && Array.isArray(cache.metas)
    && Date.now() - cache.ts < REGISTRY_CACHE_TTL;

  if (!background && cacheValid) {
    ACTIVITY_META = await attachPermissionFlags(enrichAllMetas(
      cache.metas,
      bundledIds,
      HOST_ACTIVITY_STATUS,
      lastRemoteUpdateInfo?.extensionVersion,
    ));
    refreshRegistryInBackground(bundledIds);
    return;
  }

  const remoteIds = await fetchRemoteRegistryIds();
  const allIds    = mergeRegistryIds(remoteIds, bundledIds);
  ACTIVITY_META   = await fetchRegistryMetas(allIds, bundledIds);
  await saveRegistryCache(ACTIVITY_META, allIds);
}

async function refreshRegistryInBackground(bundledIds) {
  try {
    const remoteIds = await fetchRemoteRegistryIds();
    if (!remoteIds) return;

    const allIds     = mergeRegistryIds(remoteIds, bundledIds);
    const currentKey = ACTIVITY_META.map(a => a.id).sort().join(',');
    const newKey     = [...allIds].sort().join(',');

    if (currentKey !== newKey) {
      ACTIVITY_META = await fetchRegistryMetas(allIds, bundledIds);
      await saveRegistryCache(ACTIVITY_META, allIds);
      renderActivities(searchInput?.value || '');
      return;
    }

    const before = ACTIVITY_META.map(a => `${a.id}:${a._ready}:${a._lockReason}`).join('|');
    ACTIVITY_META = await attachPermissionFlags(enrichAllMetas(
      ACTIVITY_META,
      bundledIds,
      HOST_ACTIVITY_STATUS,
      lastRemoteUpdateInfo?.extensionVersion,
    ));
    const after = ACTIVITY_META.map(a => `${a.id}:${a._ready}:${a._lockReason}`).join('|');
    if (before !== after) renderActivities(searchInput?.value || '');
  } catch {}
}

async function applyHostActivityStatus(hostStatus) {
  if (!hostStatus?.length) return false;
  HOST_ACTIVITY_STATUS = hostStatus;
  const before = ACTIVITY_META.map(a => `${a.id}:${a._ready}`).join(',');
  ACTIVITY_META = await attachPermissionFlags(enrichAllMetas(
    ACTIVITY_META,
    BUNDLED_ACTIVITY_IDS,
    HOST_ACTIVITY_STATUS,
    lastRemoteUpdateInfo?.extensionVersion,
  ));
  const after = ACTIVITY_META.map(a => `${a.id}:${a._ready}`).join(',');
  return before !== after;
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
const statusPill     = $('status-pill');
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
const updatesPanel   = $('updates-panel');
const footer         = $('footer');
const brandIcon      = document.querySelector('.brand-icon');

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
  const meta = ACTIVITY_META.find(a => a.id === id);

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
  return true;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function setStatus(state, errorMsg) {
  statusDot.className = `status-dot ${state}`;
  const labels = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting…' };
  const label = labels[state] || state;
  statusLabel.textContent = label;
  if (statusPill) statusPill.title = label;
  footer.classList.toggle('hidden-footer', state === 'connected');
  const errEl = $('footer-error');
  if (errEl) errEl.textContent = errorMsg ? `Error: ${errorMsg}` : '';
}

function renderUpdateBanner(updateInfo) {
  if (bannerDismissed || !updateInfo) {
    updateBanner.classList.add('hidden');
    return;
  }

  const { hostUpdate, updatedActivities, activityStatus } = updateInfo;
  const activityOutdated = (activityStatus ?? []).some(a => a.installed && !a.upToDate);

  if (hostUpdate?.available === true) {
    updateBannerTitle.textContent = `Host Update — v${hostUpdate.latestVersion}`;
    updateBannerSub.textContent   = `Installed v${hostUpdate.currentVersion} — run Syncr Setup to update`;
    updateBannerBtn.href          = hostUpdate.setupDownloadUrl || RELEASES_URL;
    updateBannerBtn.textContent   = 'Get Syncr Setup';
    updateBannerBtn.dataset.action = 'open-updates';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (activityOutdated) {
    updateBannerTitle.textContent = 'Activity Updates Available';
    updateBannerSub.textContent   = 'Open Updates to download and apply from GitHub';
    updateBannerBtn.href          = '#';
    updateBannerBtn.textContent   = 'View Updates';
    updateBannerBtn.dataset.action = 'open-updates';
    updateBanner.classList.remove('hidden');
    return;
  }

  if (updatedActivities?.length > 0) {
    const names = updatedActivities.join(', ');
    updateBannerTitle.textContent = 'Activities Updated';
    updateBannerSub.textContent   = `${names} — hot-reloaded automatically`;
    updateBannerBtn.href          = RELEASES_URL;
    updateBannerBtn.textContent   = 'Changelog';
    delete updateBannerBtn.dataset.action;
    updateBanner.classList.remove('hidden');
    return;
  }

  updateBanner.classList.add('hidden');
}

updateBannerBtn.addEventListener('click', e => {
  if (updateBannerBtn.dataset.action === 'open-updates') {
    e.preventDefault();
    openUpdatesPanel();
  }
});

function setBadge(el, kind, text) {
  el.className = `update-badge ${kind}`;
  el.textContent = text;
}

function activityDisplayName(id) {
  return ACTIVITY_META.find(a => a.id === id)?.name ?? id;
}

function renderActivitiesUpdateList(activityStatus) {
  const list = $('u-activities-list');
  if (!activityStatus?.length) {
    list.innerHTML = '<div class="updates-empty">Connect to the native host and check for updates.</div>';
    return;
  }

  list.innerHTML = activityStatus.map(a => {
    const meta = ACTIVITY_META.find(m => m.id === a.id);
    const minEngine = meta?.minEngineVersion || meta?.minExtensionVersion || '2.0.0';
    const engineOk = semverGte(ENGINE_VERSION, minEngine);
    let statusClass = 'muted';
    let statusText  = 'Not installed';

    if (!engineOk) {
      statusClass = 'warn';
      statusText  = 'Needs engine update';
    } else if (a.installed && a.upToDate) {
      statusClass = 'ok';
      statusText  = 'Up to date';
    } else if (a.installed) {
      statusClass = 'warn';
      statusText  = 'Host update available';
    } else {
      statusClass = 'warn';
      statusText  = 'Host install needed';
    }

    const note = !engineOk && minEngine
      ? ` · engine v${minEngine}+`
      : '';

    return `<div class="updates-activity-row">
      <span class="updates-activity-name">${esc(activityDisplayName(a.id))}${note}</span>
      <span class="update-badge ${statusClass}">${statusText}</span>
    </div>`;
  }).join('');
}

function renderUpdatesPanel(remote, hostInfo) {
  const extLatest = remote?.extensionVersion ?? '—';
  const hostLatest = remote?.hostVersion ?? '—';
  const hostInstalled = hostInfo?.hostVersion ?? hostInfo?.hostUpdate?.currentVersion ?? '—';

  $('u-ext-installed').textContent = EXT_VERSION;
  $('u-ext-latest').textContent    = extLatest;
  $('u-host-installed').textContent = currentState.connected ? hostInstalled : '—';
  $('u-host-latest').textContent   = hostLatest;

  const extOutdated = remote?.extensionVersion && semverGt(remote.extensionVersion, EXT_VERSION);
  setBadge($('u-ext-status'), extOutdated ? 'warn' : 'ok', extOutdated ? 'Update available' : 'Up to date');

  const hostOutdated = hostInfo?.hostUpdate?.available === true;
  if (!currentState.connected) {
    setBadge($('u-host-status'), 'muted', 'Host disconnected');
  } else {
    setBadge($('u-host-status'), hostOutdated ? 'warn' : 'ok', hostOutdated ? 'Update available' : 'Up to date');
  }

  const extRow = $('u-ext-download-row');
  if (extOutdated && remote?.downloads?.xpi) {
    extRow.classList.remove('hidden');
    $('u-ext-download').href = remote.downloads.xpi;
  } else {
    extRow.classList.add('hidden');
  }

  const setupRow = $('u-host-setup-row');
  const exeRow   = $('u-host-exe-row');
  if (hostOutdated) {
    setupRow.classList.remove('hidden');
    $('u-host-setup').href = hostInfo?.hostUpdate?.setupDownloadUrl || remote?.downloads?.setup || RELEASES_URL;
    if (remote?.downloads?.host) {
      exeRow.classList.remove('hidden');
      $('u-host-exe').href = remote.downloads.host;
    } else {
      exeRow.classList.add('hidden');
    }
  } else {
    setupRow.classList.add('hidden');
    exeRow.classList.add('hidden');
  }

  renderActivitiesUpdateList(hostInfo?.activityStatus ?? []);

  const note = $('updates-host-note');
  if (!currentState.connected) {
    note.textContent = 'Native host is disconnected — extension and GitHub versions are shown, but activity status requires a connection.';
  } else if (hostInfo?.updatedActivities?.length) {
    note.textContent = `Applied updates: ${hostInfo.updatedActivities.join(', ')}`;
  } else {
    note.textContent = '';
  }
}

let lastRemoteUpdateInfo = null;
let updatesPanelOpen = false;

function syncPageScrollLock() {
  const overlayOpen = !settingsPanel.classList.contains('hidden')
    || !updatesPanel.classList.contains('hidden');
  document.body.style.overflow = overlayOpen ? 'hidden' : '';
}

function openUpdatesPanel() {
  settingsPanel.classList.add('hidden');
  updatesPanel.classList.remove('hidden');
  updatesPanel.scrollTop = 0;
  updatesPanelOpen = true;
  syncPageScrollLock();
  $('s-ext-version').textContent = EXT_VERSION;
  $('s-engine-version').textContent = ENGINE_VERSION;
  renderUpdatesPanel(lastRemoteUpdateInfo, currentState.updateInfo ?? null);
  if (!lastRemoteUpdateInfo) runUpdateCheck(false);
}

async function runUpdateCheck(apply = true) {
  const btn = $('btn-check-updates');
  btn.disabled = true;
  btn.textContent = 'Checking…';

  try {
    lastRemoteUpdateInfo = await fetchRemoteUpdateInfo();

    let hostInfo = currentState.updateInfo ?? null;
    if (currentState.connected) {
      const res = await browser.runtime.sendMessage({ type: 'host:checkUpdates', apply });
      if (res?.ok) {
        hostInfo = {
          updatedActivities: res.updatedActivities ?? [],
          activityStatus:    res.activityStatus ?? [],
          hostUpdate:        res.hostUpdate ?? null,
          hostVersion:       res.hostVersion ?? null,
        };
        currentState.updateInfo = hostInfo;
      } else if (res?.error) {
        $('updates-host-note').textContent = res.error;
      }
    }

    renderUpdatesPanel(lastRemoteUpdateInfo, hostInfo);
    renderUpdateBanner(hostInfo);
    $('updates-last-checked').textContent = `Last checked ${new Date().toLocaleTimeString()}`;
  } catch (err) {
    $('updates-host-note').textContent = `Check failed: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Check for updates';
  }
}

/**
 * Extract a human-readable title + optional subtitle from raw activity data.
 * Both content scripts send `data.title` as the primary field.
 * YouTube Music adds `data.artist`; YouTube adds `data.channelName`.
 */
function getActivityTitle(data) {
  if (!data) return null;
  if (data.browsing) {
    const ctx = data.browsingContext && data.browsingContext !== 'Home'
      ? data.browsingContext
      : null;
    return { title: ctx ? `Browsing ${ctx}` : 'Browsing…', sub: null };
  }
  if (data.mode === 'search' && data.searchQuery) {
    return { title: `Searching: ${data.searchQuery}`, sub: null };
  }
  if (data.context) return { title: data.context, sub: null };
  if (!data.title) return null;
  const sub = data.artist      ? `by ${data.artist}`
            : data.channelName ? `by ${data.channelName}`
            : data.author      ? `${data.subreddit || 'Reddit'} · u/${String(data.author).replace(/^u\//, '')}`
            : data.mediaType === 'show' && (data.seasonNumber != null || data.episodeNumber != null)
              ? `S${data.seasonNumber ?? '?'} · E${data.episodeNumber ?? '?'}${data.episodeTitle ? `: ${data.episodeTitle}` : ''}`
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
    input.addEventListener('change', e => {
      const id      = e.target.dataset.id;
      const meta    = ACTIVITY_META.find(a => a.id === id);
      if (meta && !meta._ready) {
        e.target.checked = false;
        return;
      }
      const enabled = e.target.checked;
      const card    = activitiesList.querySelector(`.activity-card[data-id="${id}"]`);

      if (enabled) {
        setActivityEnabled(id, true).then(() => {
          if (card) card.classList.toggle('is-disabled', false);
        });
        return;
      }

      setActivityEnabled(id, false).then(() => {
        if (card) card.classList.toggle('is-disabled', true);
        renderNowPlaying(null, null);
        renderActivities(searchInput.value);
      });
    });
  });

  activitiesList.querySelectorAll('[data-update-host]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      openUpdatesPanel();
      await runUpdateCheck(true);
    });
  });

  activitiesList.querySelectorAll('[data-update-ext]').forEach(link => {
    link.addEventListener('click', e => {
      if (!link.href || link.href === '#') {
        e.preventDefault();
        browser.tabs.create({ url: RELEASES_URL });
      }
    });
  });
}

function buildCard(meta) {
  const isActive  = !!(currentState.liveActivities?.[meta.id]);
  const isEnabled = meta._ready && !disabledActivities.has(meta.id);
  const isLocked  = !meta._ready;
  const imgUrl    = resolveActivityImage(meta);

  const logoInner = imgUrl
    ? `<img src="${esc(imgUrl)}" alt="${esc(meta.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:5px" />`
    : `<span style="font-size:20px;line-height:1">${esc(meta.icon || '🔌')}</span>`;

  let tagText = isActive ? 'Live' : esc(meta.category || '');
  if (isLocked) tagText = 'Update needed';

  let updateHint = '';
  if (isLocked && meta._lockReason) {
    if (meta._lockAction === 'extension') {
      const xpiUrl = lastRemoteUpdateInfo?.downloads?.xpi || RELEASES_URL;
      updateHint = `<div class="ac-update-hint">${esc(meta._lockReason)} · <a class="ac-update-link" data-update-ext href="${esc(xpiUrl)}" target="_blank" rel="noopener">Get extension update</a></div>`;
    } else if (meta._lockAction === 'host') {
      updateHint = `<div class="ac-update-hint">${esc(meta._lockReason)} · <button type="button" class="ac-update-link" data-update-host="${esc(meta.id)}">Update host activity</button></div>`;
    } else {
      updateHint = `<div class="ac-update-hint">${esc(meta._lockReason)}</div>`;
    }
  }

  return `
    <div class="activity-card ${isActive ? 'active-now' : ''} ${!isEnabled ? 'is-disabled' : ''} ${isLocked ? 'is-locked' : ''}" data-id="${esc(meta.id)}">
      <div class="ac-logo">${logoInner}</div>
      <div class="ac-body">
        <div class="ac-name-row">
          <span class="ac-name">${esc(meta.name)}</span>
          <span class="ac-tag ${isLocked ? 'ac-tag-warn' : ''}">${tagText}</span>
        </div>
        <div class="ac-desc">${esc(meta.description || '')}</div>
        ${updateHint}
      </div>
      <div class="toggle-wrap">
        <label class="toggle" title="${isLocked ? esc(meta._lockReason) : (isEnabled ? 'Disable' : 'Enable') + ' ' + esc(meta.name)}">
          <input type="checkbox" ${isEnabled ? 'checked' : ''} ${isLocked ? 'disabled' : ''} data-id="${esc(meta.id)}" />
          <div class="toggle-track"></div>
          <div class="toggle-thumb"></div>
        </label>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

$('btn-settings').addEventListener('click', () => {
  updatesPanel.classList.add('hidden');
  settingsPanel.classList.remove('hidden');
  settingsPanel.scrollTop = 0;
  syncPageScrollLock();
  $('s-ext-version').textContent = EXT_VERSION;
  $('s-engine-version').textContent = ENGINE_VERSION;
  $('s-host-status').textContent = currentState.connected ? 'Connected' : 'Not connected';
});

$('settings-back').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  syncPageScrollLock();
});

$('btn-updates').addEventListener('click', openUpdatesPanel);
$('open-updates').addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
  openUpdatesPanel();
});
$('updates-back').addEventListener('click', () => {
  updatesPanel.classList.add('hidden');
  updatesPanelOpen = false;
  syncPageScrollLock();
});
$('btn-check-updates').addEventListener('click', () => runUpdateCheck(true));

$('open-setup').addEventListener('click', e => {
  e.preventDefault();
  browser.tabs.create({ url: RELEASES_URL });
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
  browser.tabs.create({ url: RELEASES_URL });
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

    if (await applyHostActivityStatus(state.updateInfo?.activityStatus ?? [])) {
      renderActivities(searchInput.value);
    }

    setStatus(state.connected ? 'connected' : 'disconnected', state.connected ? null : state.lastError);
    renderUpdateBanner(state.updateInfo ?? null);
    if (updatesPanelOpen) {
      renderUpdatesPanel(lastRemoteUpdateInfo, state.updateInfo ?? null);
    }
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
  await Promise.all([loadDisabled(), loadEngineVersion(), loadActivityRegistry()]);
  $('s-ext-version').textContent = EXT_VERSION;
  $('s-engine-version').textContent = ENGINE_VERSION;
  renderActivities();
  await syncState();

  // Refresh remote registry + apply host activity hot-updates without full Setup
  lastRemoteUpdateInfo = await fetchRemoteUpdateInfo().catch(() => null);
  refreshRegistryInBackground(BUNDLED_ACTIVITY_IDS);
  if (currentState.connected) {
    runUpdateCheck(true).catch(() => {});
  }
})();

const pollInterval = setInterval(syncState, 1000);
window.addEventListener('unload', () => clearInterval(pollInterval));
