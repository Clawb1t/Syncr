'use strict';

/**
 * Dynamic activity injector — remote scrapers only (scraper.json on GitHub).
 * Bundled activities use manifest content_scripts for reliable Firefox injection.
 */

const INJECTOR_GITHUB_RAW = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
const META_CACHE_MS       = 5 * 60 * 1000;

let disabledActivities = new Set();
const metaCache        = new Map();
const tabInjected      = new Map();

async function loadDisabledActivities() {
  try {
    const stored = await browser.storage.local.get('disabledActivities');
    disabledActivities = new Set(stored.disabledActivities || []);
  } catch {
    disabledActivities = new Set();
  }
}

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

async function hasGrantedOrigins(origins) {
  if (!origins?.length) return false;
  try {
    const all = await browser.permissions.getAll();
    const granted = all.origins || [];
    if (granted.includes('<all_urls>') || granted.includes('*://*/*')) return true;
    for (const need of origins) {
      const ok = granted.includes(need) || await browser.permissions.contains({ origins: [need] });
      if (!ok) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function injectRemote(tabId, activityId) {
  const config = JSON.stringify({ activityId, githubRaw: INJECTOR_GITHUB_RAW });
  await browser.tabs.executeScript(tabId, {
    code: `window.__SYNCR__=${config};`,
    runAt: 'document_start',
  });
  await browser.tabs.executeScript(tabId, {
    file: 'activities/_runtime/runner.js',
  });
}

async function injectActivity(tabId, activityId) {
  const set = tabInjected.get(tabId) || new Set();
  if (set.has(activityId)) return;
  try {
    await injectRemote(tabId, activityId);
    set.add(activityId);
    tabInjected.set(tabId, set);
  } catch (err) {
    console.warn(`[Syncr] remote inject failed for ${activityId} on tab ${tabId}:`, err?.message || err);
  }
}

async function syncTab(tabId, url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  await loadDisabledActivities();

  const ids = await loadRegistryIds();

  for (const id of ids) {
    if (disabledActivities.has(id)) continue;

    const meta = await fetchActivityMeta(id);
    if (!meta || !isRemoteScraper(meta)) continue;

    const origins = activityOrigins(meta);
    if (!urlMatchesPatterns(url, origins)) continue;
    if (!await hasGrantedOrigins(origins)) continue;

    await injectActivity(tabId, id);
  }
}

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab?.url) {
    syncTab(tabId, tab.url);
  } else if (changeInfo.url) {
    tabInjected.delete(tabId);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await browser.tabs.get(tabId);
    if (tab?.url) syncTab(tabId, tab.url);
  } catch {}
});

browser.tabs.onRemoved.addListener(tabId => {
  tabInjected.delete(tabId);
});

if (browser.permissions?.onAdded) {
  browser.permissions.onAdded.addListener(() => {
    tabInjected.clear();
    scanAllTabs();
  });
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'activity:permissionChanged') {
    if (msg.activityId) metaCache.delete(msg.activityId);
    tabInjected.clear();
    scanAllTabs();
    return;
  }

  if (msg.type === 'activity:resyncTabs') {
    tabInjected.clear();
    scanAllTabs();
    sendResponse({ ok: true });
    return true;
  }
});

async function scanAllTabs() {
  try {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) await syncTab(tab.id, tab.url);
    }
  } catch (err) {
    console.warn('[Syncr] tab scan failed:', err?.message || err);
  }
}

browser.runtime.onInstalled.addListener(() => {
  tabInjected.clear();
  scanAllTabs();
});

scanAllTabs();
