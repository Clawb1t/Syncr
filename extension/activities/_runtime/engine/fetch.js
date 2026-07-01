'use strict';

const SyncrEngineFetch = (function () {
  const MAX_BYTES = 2 * 1024 * 1024;
  const caches = new Map();

  function originAllowed(url, fetchOrigins) {
    if (!fetchOrigins?.length) return false;
    try {
      const u = new URL(url);
      return fetchOrigins.some(o => u.origin === o || u.href.startsWith(o));
    } catch {
      return false;
    }
  }

  function getCache(activityId) {
    if (!caches.has(activityId)) {
      caches.set(activityId, new Map());
    }
    return caches.get(activityId);
  }

  function clearCache(activityId) {
    caches.delete(activityId);
  }

  async function fetchJson(spec, ctx, options) {
    const { fetchOrigins, activityId } = options;
    const url = SyncrEngineEmit.interpolate(spec.url, ctx);
    if (!originAllowed(url, fetchOrigins)) return null;

    const cacheKey = spec.cacheKey ? SyncrEngineEmit.interpolate(spec.cacheKey, ctx) : url;
    const ttlMs = spec.ttlMs ?? 300000;
    const cache = getCache(activityId);

    if (cacheKey && cache.has(cacheKey)) {
      const entry = cache.get(cacheKey);
      if (Date.now() - entry.ts < ttlMs) return entry.data;
    }

    try {
      const res = await fetch(url, {
        credentials: spec.credentials === 'include' ? 'include' : 'same-origin',
        cache:       'no-store',
      });
      if (!res.ok) return null;

      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) return null;

      const data = JSON.parse(new TextDecoder().decode(buf));

      if (cacheKey) {
        cache.set(cacheKey, { data, ts: Date.now() });
        if (cache.size > 20) {
          const first = cache.keys().next().value;
          cache.delete(first);
        }
      }

      return data;
    } catch {
      return null;
    }
  }

  return { fetchJson, clearCache, originAllowed };
})();
