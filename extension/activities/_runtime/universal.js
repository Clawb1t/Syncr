/**
 * Syncr universal remote activity host (manifest content script).
 *
 * PreMiD-style flow: on each page load, ask the background which remote
 * activity matches this URL, fetch scraper.json (GitHub with bundle fallback),
 * run the declarative engine. New remote activities only need GitHub files.
 */
(function () {
  'use strict';

  if (window.__SYNCR_REMOTE__) return;

  const GITHUB_RAW          = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
  const POLL_MS             = 2000;
  const RESOLVE_RETRY_MS    = 350;
  const RESOLVE_MAX_ATTEMPTS = 12;

  function tryResolve(attempt) {
    browser.runtime.sendMessage({ type: 'activity:resolveForUrl', url: location.href })
      .then(result => {
        if (result?.id) {
          if (window.__SYNCR_REMOTE__) return;
          window.__SYNCR_REMOTE__ = result.id;
          runRemoteActivity(result.id);
          return;
        }
        if (!result?.ready && attempt < RESOLVE_MAX_ATTEMPTS) {
          setTimeout(() => tryResolve(attempt + 1), RESOLVE_RETRY_MS);
        }
      })
      .catch(() => {
        if (attempt < RESOLVE_MAX_ATTEMPTS) {
          setTimeout(() => tryResolve(attempt + 1), RESOLVE_RETRY_MS);
        }
      });
  }

  tryResolve(0);

  function runRemoteActivity(ACTIVITY_ID) {
    let lastSent     = null;
    let lastUrl      = window.location.href;
    let scraperDef   = null;
    let scrapeBusy   = false;

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
        if (evalWhen(rule.when)) return resolveEmit(rule.emit);
      }
      if (def.default) return resolveEmit(def.default);
      return null;
    }

    async function loadScraper() {
      if (scraperDef) return scraperDef;

      try {
        const remote = await fetch(
          `${GITHUB_RAW}/extension/activities/${ACTIVITY_ID}/scraper.json`,
          { cache: 'no-store' },
        );
        if (remote.ok) {
          scraperDef = await remote.json();
          return scraperDef;
        }
      } catch {}

      try {
        const local = await fetch(
          browser.runtime.getURL(`activities/${ACTIVITY_ID}/scraper.json`),
          { cache: 'no-store' },
        );
        if (local.ok) {
          scraperDef = await local.json();
          return scraperDef;
        }
      } catch {}

      return null;
    }

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
          scraperDef = null;
        }

        const enabled = await browser.runtime.sendMessage({
          type: 'activity:isEnabled', activityId: ACTIVITY_ID,
        }).catch(() => ({ enabled: false }));

        if (!enabled?.enabled) {
          if (lastSent !== null) {
            lastSent = null;
            browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
          }
          return;
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
      scraperDef = null;
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
  }
})();
