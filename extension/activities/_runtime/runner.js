/**
 * Syncr remote activity runner (injected into pages).
 * Fetches activities/{id}/scraper.json from GitHub and runs the declarative engine.
 */
(function () {
  'use strict';

  const cfg = window.__SYNCR__;
  if (!cfg?.activityId || !cfg?.githubRaw) return;

  const ACTIVITY_ID = cfg.activityId;
  const GITHUB_RAW  = cfg.githubRaw;
  const POLL_MS     = 2000;

  let lastSent   = null;
  let lastUrl    = window.location.href;
  let scraperDef = null;
  let scrapeBusy = false;

  // ---------------------------------------------------------------------------
  // Declarative scraper engine (v1)
  // ---------------------------------------------------------------------------

  function getPath() {
    return window.location.pathname.toLowerCase();
  }

  function hashParams() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return new URLSearchParams();
    try { return new URLSearchParams(raw); } catch { return new URLSearchParams(); }
  }

  function searchParams() {
    return new URLSearchParams(window.location.search);
  }

  function evalWhen(when) {
    if (!when) return true;

    if (when.hostnameIncludes) {
      const h = window.location.hostname.toLowerCase();
      const list = Array.isArray(when.hostnameIncludes) ? when.hostnameIncludes : [when.hostnameIncludes];
      if (!list.some(s => h.includes(String(s).toLowerCase()))) return false;
    }

    if (when.pathIncludes) {
      const path = getPath();
      const list = Array.isArray(when.pathIncludes) ? when.pathIncludes : [when.pathIncludes];
      if (!list.some(s => path.includes(String(s).toLowerCase()))) return false;
    }

    if (when.pathRegex) {
      const re = new RegExp(when.pathRegex, when.pathRegexFlags || 'i');
      if (!re.test(window.location.pathname)) return false;
    }

    if (when.searchParam) {
      for (const [key, val] of Object.entries(when.searchParam)) {
        const got = searchParams().get(key);
        if (val === '*' ? !got : got !== val) return false;
      }
    }

    if (when.hashParam) {
      const hp = hashParams();
      for (const [key, val] of Object.entries(when.hashParam)) {
        const got = hp.get(key);
        if (val === '*' ? !got : got !== val) return false;
      }
    }

    if (when.hashParamAny) {
      const hp = hashParams();
      const keys = Array.isArray(when.hashParamAny) ? when.hashParamAny : [when.hashParamAny];
      if (!keys.some(k => hp.get(k))) return false;
    }

    if (when.selectorExists) {
      const sels = Array.isArray(when.selectorExists) ? when.selectorExists : [when.selectorExists];
      if (!sels.some(s => document.querySelector(s))) return false;
    }

    if (when.selectorNotExists) {
      const sels = Array.isArray(when.selectorNotExists) ? when.selectorNotExists : [when.selectorNotExists];
      if (sels.some(s => document.querySelector(s))) return false;
    }

    if (when.pathSegmentAfter) {
      const segments = getPath().split('/').filter(Boolean);
      let matched = false;
      for (const [folder, minAfter] of Object.entries(when.pathSegmentAfter)) {
        const idx = segments.indexOf(folder.toLowerCase());
        const need = minAfter ?? 1;
        if (idx >= 0 && segments.length > idx + need) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }

    return true;
  }

  function resolveTemplate(value) {
    if (typeof value !== 'string') return value;
    return value
      .replace(/\{url\}/g, window.location.href)
      .replace(/\{origin\}/g, window.location.origin)
      .replace(/\{path\}/g, window.location.pathname);
  }

  function resolveEmit(emit) {
    if (!emit || typeof emit !== 'object') return emit;
    const out = {};
    for (const [k, v] of Object.entries(emit)) {
      out[k] = resolveTemplate(v);
    }
    return out;
  }

  function runEngine(def) {
    if (!def) return null;

    for (const rule of def.rules || []) {
      if (evalWhen(rule.when)) {
        return resolveEmit(rule.emit);
      }
    }

    if (def.default) return resolveEmit(def.default);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Fetch scraper definition
  // ---------------------------------------------------------------------------

  async function loadScraper() {
    if (scraperDef) return scraperDef;
    const url = `${GITHUB_RAW}/extension/activities/${ACTIVITY_ID}/scraper.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    scraperDef = await res.json();
    return scraperDef;
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  function dataChanged(a, b) {
    if (!a || !b) return true;
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  async function poll() {
    if (scrapeBusy) return;
    scrapeBusy = true;

    try {
      if (window.location.href !== lastUrl) {
        lastUrl  = window.location.href;
        lastSent = null;
      }

      const def  = await loadScraper();
      const data = runEngine(def);

      if (!data) {
        if (lastSent !== null) {
          lastSent = null;
          browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
        }
        return;
      }

      if (!dataChanged(lastSent, data)) return;
      lastSent = data;

      browser.runtime.sendMessage({
        type:       'activity:update',
        activityId: ACTIVITY_ID,
        data,
      }).catch(() => {});
    } finally {
      scrapeBusy = false;
    }
  }

  const intervalId = setInterval(poll, POLL_MS);

  window.addEventListener('popstate', () => {
    lastSent = null;
    poll();
  });

  window.addEventListener('hashchange', () => {
    lastSent = null;
    poll();
  });

  window.addEventListener('unload', () => {
    clearInterval(intervalId);
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  });

  poll();
})();
