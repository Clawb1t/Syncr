/**
 * Syncr universal remote activity host — bootstrap for Scraper Engine v2.
 */
(function () {
  'use strict';

  if (window.__SYNCR_REMOTE__) return;

  const GITHUB_RAW           = 'https://raw.githubusercontent.com/Clawb1t/Syncr/main';
  const RESOLVE_RETRY_MS     = 350;
  const RESOLVE_MAX_ATTEMPTS = 12;

  let resolveBusy = false;

  function tryResolve(attempt) {
    if (window.__SYNCR_REMOTE__) return;
    if (resolveBusy && attempt === 0) return;
    resolveBusy = true;

    browser.runtime.sendMessage({ type: 'activity:resolveForUrl', url: location.href })
      .then(result => {
        resolveBusy = false;
        if (result?.id) {
          if (window.__SYNCR_REMOTE__) return;
          window.__SYNCR_REMOTE__ = result.id;
          window.__SYNCR_RESOLVED_ORIGIN__ = location.origin;
          runRemoteActivity(result.id, result);
          return;
        }
        if (!result?.ready && attempt < RESOLVE_MAX_ATTEMPTS) {
          setTimeout(() => tryResolve(attempt + 1), RESOLVE_RETRY_MS);
        }
      })
      .catch(() => {
        resolveBusy = false;
        if (attempt < RESOLVE_MAX_ATTEMPTS) {
          setTimeout(() => tryResolve(attempt + 1), RESOLVE_RETRY_MS);
        }
      });
  }

  function onNavigate() {
    if (window.__SYNCR_REMOTE__ && window.__SYNCR_RESOLVED_ORIGIN__ !== location.origin) {
      window.__SYNCR_REMOTE__ = null;
      window.__SYNCR_RESOLVED_ORIGIN__ = null;
    }
    if (window.__SYNCR_REMOTE__) return;
    tryResolve(0);
  }

  const pushState    = history.pushState.bind(history);
  const replaceState = history.replaceState.bind(history);
  history.pushState    = (...args) => { pushState(...args);    onNavigate(); };
  history.replaceState = (...args) => { replaceState(...args); onNavigate(); };
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('hashchange', onNavigate);

  tryResolve(0);

  function runRemoteActivity(ACTIVITY_ID, resolveInfo) {
    const Engine = window.SyncrEngine;
    if (!Engine) return;

    const fetchOrigins = resolveInfo?.fetchOrigins || [];
    let scraperDef     = null;
    let scrapeBusy     = false;
    let lastUrl        = location.href;
    const changeState  = Engine.SyncrEngineChangeDetection.createState();
    let pollMs         = 2000;

    async function loadScraper() {
      if (scraperDef) return scraperDef;

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
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          Engine.SyncrEngineChangeDetection.reset(changeState);
          scraperDef = null;
          Engine.SyncrEngineFetch.clearCache(ACTIVITY_ID);
        }

        const enabled = await browser.runtime.sendMessage({
          type: 'activity:isEnabled', activityId: ACTIVITY_ID,
        }).catch(() => ({ enabled: false }));

        if (!enabled?.enabled) {
          if (changeState.lastSent !== null) {
            Engine.SyncrEngineChangeDetection.reset(changeState);
            browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
          }
          return;
        }

        const def = await loadScraper();
        if (!def) return;

        pollMs = Math.max(1000, def.pollMs || 2000);

        const data = await Engine.evaluate(def, document, location, {
          fetchOrigins,
          activityId: ACTIVITY_ID,
        });

        if (!data) {
          if (changeState.lastSent !== null) {
            Engine.SyncrEngineChangeDetection.reset(changeState);
            browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
          }
          return;
        }

        const cd = def.changeDetection;
        if (cd && !Engine.SyncrEngineChangeDetection.shouldSend(data, changeState, cd)) {
          return;
        }

        if (!cd && !dataChanged(changeState.lastSent, data)) return;

        Engine.SyncrEngineChangeDetection.trackSent(data, changeState, cd);
        browser.runtime.sendMessage({
          type:       'activity:update',
          activityId: ACTIVITY_ID,
          data,
        }).catch(() => {});
      } finally {
        scrapeBusy = false;
      }
    }

    const intervalId = setInterval(poll, pollMs);

    const extraEvents = [];
    loadScraper().then(def => {
      if (!def?.events) return;
      for (const ev of def.events) {
        if (ev === 'popstate' || ev === 'hashchange') continue;
        if (extraEvents.includes(ev)) continue;
        extraEvents.push(ev);
        window.addEventListener(ev, () => {
          Engine.SyncrEngineChangeDetection.reset(changeState);
          scraperDef = null;
          poll();
        });
      }
    }).catch(() => {});

    window.addEventListener('popstate', () => {
      Engine.SyncrEngineChangeDetection.reset(changeState);
      scraperDef = null;
      poll();
    });

    window.addEventListener('hashchange', () => {
      Engine.SyncrEngineChangeDetection.reset(changeState);
      poll();
    });

    window.addEventListener('unload', () => {
      clearInterval(intervalId);
      browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
    });

    poll();
  }
})();
