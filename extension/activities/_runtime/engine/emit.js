'use strict';

const SyncrEngineEmit = (function () {
  const NUMERIC_KEYS = new Set([
    'currentTime', 'duration', 'seasonNumber', 'episodeNumber',
    'year', 'runtimeMinutes', 'score',
  ]);

  function interpolate(template, ctx) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
      const parts = key.trim().split('.');
      let val = ctx;
      for (const p of parts) {
        if (val == null) return '';
        val = val[p];
      }
      if (val == null) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
  }

  function resolveEmit(emit, ctx) {
    if (!emit || typeof emit !== 'object') return emit;
    const out = {};
    for (const [k, v] of Object.entries(emit)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'boolean' || typeof v === 'number') {
        out[k] = v;
        continue;
      }
      if (typeof v === 'object' && !Array.isArray(v)) {
        out[k] = resolveEmit(v, ctx);
        continue;
      }
      const resolved = interpolate(String(v), ctx);
      if (k === 'paused' || k === 'browsing') {
        out[k] = resolved === 'true' ? true : resolved === 'false' ? false : (v === true || v === false ? v : resolved);
        continue;
      }
      if (NUMERIC_KEYS.has(k) && resolved !== '' && !isNaN(Number(resolved))) {
        out[k] = Number(resolved);
      } else {
        out[k] = resolved;
      }
    }
    return out;
  }

  function resolveTemplateValue(value, ctx) {
    if (typeof value !== 'string') return value;
    return interpolate(value, ctx)
      .replace(/\{url\}/g, ctx.url || '')
      .replace(/\{origin\}/g, ctx.origin || '')
      .replace(/\{path\}/g, ctx.path || '');
  }

  return { resolveEmit, interpolate, resolveTemplateValue };
})();
