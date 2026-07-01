'use strict';

/**
 * Dynamic activity injector — runs site scrapers without manifest content_scripts.
 * Bundled activities: inject activities/{id}/content-script.js
 * Remote activities: inject activities/_runtime/runner.js (fetches scraper.json from GitHub)
 */

const INJECTOR_GITHUB_RAW = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const META_CACHE_MS       = 5 * 60 * 1000;

let disabledActivities  = new Set();
const metaCache         = new Map(); // id -> { meta, ts }
const tabInjected       = new Map(); // tabId -> Set<activityId>
const tabOrigin         = new Map(); // tabId -> origin string

browser.storage.local.get('disabledActivities').then(stored => {
  disabledActivities = new Set(stored.disabledActivities || []);
}).catch(() => {});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.disabledActivities) return;
  disabledActivities = new Set(changes.disabledActivities.newValue || []);
});

function patternToRegex(pattern) {
  let p = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\*/g, '.*');
  return new RegExp(`^${p}$`);
}

function urlMatchesPatterns(url, patterns) {
  if (!url || !patterns?.length) return false;
  return patterns.some(pat => patternToRegex(pat).test(url));
}

function activityOrigins(meta) {
  if (meta?.origins?.length) return meta.origins;
  if (meta?.urlPattern) return [meta.urlPattern];
  return [];
}

function isRemoteScraper(meta) {
  return meta?.scraper === 'remote';
}

async function fetchActivityMeta(id) {
  const hit = metaCache.get(id);
  if (hit && Date.now() - hit.ts < META_CACHE_MS) return hit.meta;

  try {
    const res = await fetch(`${INJECTOR_GITHUB_RAW}/extension/activities/${id}/metadata.json`, { cache: 'no-store' });
    if (res.ok) {
      const meta = await res.json();
      metaCache.set(id, { meta, ts: Date.now() });
      return meta;
    }
  } catch {}

  try {
    const meta = await fetch(browser.runtime.getURL(`activities/${id}/metadata.json`)).then(r => r.json());
    metaCache.set(id, { meta, ts: Date.now() });
    return meta;
  } catch {
    return null;
  }
}

async function loadRegistryIds() {
  try {
    const remote = await fetch(`${INJECTOR_GITHUB_RAW}/extension/activities/registry.json`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null);
    const bundled = await fetch(browser.runtime.getURL('activities/registry.json')).then(r => r.json());
    return [...new Set([...(remote?.activities ?? []), ...(bundled?.activities ?? [])])];
  } catch {
    return [];
  }
}

async function hasPermission(origins) {
  if (!origins?.length) return false;
  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return false;
  }
}

function clearTabInjection(tabId) {
  tabInjected.delete(tabId);
}

async function injectBundled(tabId, activityId) {
  await browser.tabs.executeScript(tabId, {
    file: `activities/${activityId}/content-script.js`,
    runAt: 'document_idle',
  });
}

async function injectRemote(tabId, activityId) {
  const config = JSON.stringify({ activityId, githubRaw: INJECTOR_GITHUB_RAW });
  await browser.tabs.executeScript(tabId, {
    code: `window.__SYNCR__=${config};`,
    runAt: 'document_start',
  });
  await browser.tabs.executeScript(tabId, {
    file: 'activities/_runtime/runner.js',
    runAt: 'document_idle',
  });
}

async function injectActivity(tabId, activityId, meta) {
  const set = tabInjected.get(tabId) || new Set();
  if (set.has(activityId)) return;
  try {
    if (isRemoteScraper(meta)) {
      await injectRemote(tabId, activityId);
    } else {
      await injectBundled(tabId, activityId);
    }
    set.add(activityId);
    tabInjected.set(tabId, set);
  } catch (err) {
    // Tab may not allow injection (chrome://, PDF, etc.)
  }
}

async function syncTab(tabId, url) {
  if (!url || !/^https?:\/\//i.test(url)) return;

  let origin;
  try { origin = new URL(url).origin; } catch { return; }

  if (tabOrigin.get(tabId) !== origin) {
    clearTabInjection(tabId);
    tabOrigin.set(tabId, origin);
  }

  const ids = await loadRegistryIds();

  for (const id of ids) {
    if (disabledActivities.has(id)) continue;

    const meta = await fetchActivityMeta(id);
    if (!meta) continue;

    const origins = activityOrigins(meta);
    if (!urlMatchesPatterns(url, origins)) continue;
    if (!await hasPermission(origins)) continue;

    await injectActivity(tabId, id, meta);
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    syncTab(tabId, tab.url);
  } else if (changeInfo.url) {
    try {
      const next = new URL(changeInfo.url).origin;
      if (tabOrigin.get(tabId) && tabOrigin.get(tabId) !== next) {
        clearTabInjection(tabId);
      }
    } catch {}
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    if (tab?.url) syncTab(tabId, tab.url);
  } catch {}
});

browser.tabs.onRemoved.addListener(tabId => {
  clearTabInjection(tabId);
  tabOrigin.delete(tabId);
});

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'activity:permissionChanged') {
    metaCache.delete(msg.activityId);
    browser.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab.id != null && tab.url) syncTab(tab.id, tab.url);
      }
    }).catch(() => {});
    return;
  }

  if (msg.type === 'activity:resyncTabs') {
    browser.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab.id != null && tab.url) syncTab(tab.id, tab.url);
      }
    }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});
