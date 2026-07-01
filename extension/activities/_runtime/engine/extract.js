'use strict';

const SyncrEngineExtract = (function () {
  function isEmpty(v) {
    if (v == null) return true;
    if (typeof v === 'string') return v === '';
    if (typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).length === 0;
    return false;
  }

  function resolveRef(value, ctx) {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('{') || !value.endsWith('}')) return value;
    const key = value.slice(1, -1).trim();
    const parts = key.split('.');
    let val = ctx;
    for (const p of parts) {
      if (val == null) return '';
      val = val[p];
    }
    return val;
  }

  function runOne(spec, document, location, ctx, options) {
    if (spec == null) return null;
    if (typeof spec === 'string') return resolveRef(spec, ctx);

    if (spec.literal != null) return spec.literal;

    if (spec.urlParam) {
      return new URLSearchParams(location.search || '').get(spec.urlParam) || '';
    }

    if (spec.pathRegex) {
      const m = (location.pathname || '').match(new RegExp(spec.pathRegex, spec.flags || ''));
      const g = spec.group ?? 1;
      return m?.[g] ?? '';
    }

    if (spec.selectorText) {
      const sel = typeof spec.selectorText === 'string' ? spec.selectorText : spec.selectorText.selector;
      const el = document.querySelector(sel);
      let text = el?.textContent || '';
      if (spec.trim !== false) text = text.trim();
      return SyncrEngineContext.truncate(text, spec.maxLength);
    }

    if (spec.selectorAttr) {
      const cfg = spec.selectorAttr;
      const sel = cfg.selector;
      const el = document.querySelector(sel);
      if (!el) return '';
      let val = el.getAttribute(cfg.attr) || (cfg.attr === 'href' ? el.href : '') || (cfg.attr === 'src' ? el.src : '') || '';
      if (cfg.attr === 'textContent') val = el.textContent?.trim() || '';
      if (cfg.stripQuery && val.includes('?')) val = val.split('?')[0];
      if (cfg.stripPrefix) val = val.replace(new RegExp(cfg.stripPrefix), '');
      return SyncrEngineContext.truncate(String(val).trim(), cfg.maxLength);
    }

    if (spec.metaContent) {
      const el = document.querySelector(`meta[property="${spec.metaContent}"], meta[name="${spec.metaContent}"]`);
      return SyncrEngineContext.truncate(el?.content || '', spec.maxLength);
    }

    if (spec.title) {
      let t = document.title || '';
      if (spec.title.stripSuffix) {
        const suf = spec.title.stripSuffix;
        if (t.endsWith(suf)) t = t.slice(0, -suf.length).trim();
      }
      return SyncrEngineContext.truncate(t, spec.maxLength);
    }

    if (spec.video) {
      const cfg = spec.video;
      const el = document.querySelector(cfg.selector || 'video');
      if (!el || el.readyState < (cfg.minReadyState ?? 2)) return null;
      return {
        currentTime: el.currentTime,
        duration:    isFinite(el.duration) && el.duration > 0 ? el.duration : 0,
        paused:      el.paused,
      };
    }

    if (spec.template) {
      const keys = [...String(spec.template).matchAll(/\{([^}]+)\}/g)]
        .map(m => m[1].trim().split('.')[0]);
      for (const key of keys) {
        if (isEmpty(ctx[key])) return '';
      }
      return SyncrEngineEmit.interpolate(spec.template, ctx);
    }

    if (spec.coalesce) {
      for (const sub of spec.coalesce) {
        const v = runOne(sub, document, location, ctx, options);
        if (!isEmpty(v)) return v;
      }
      return '';
    }

    if (spec.split) {
      const src = String(resolveRef(spec.split.source, ctx) ?? '');
      const parts = src.split(spec.split.sep || ' ');
      const idx = spec.split.index ?? 0;
      return SyncrEngineContext.truncate((parts[idx] || '').trim());
    }

    if (spec.regexReplace) {
      const src = String(resolveRef(spec.regexReplace.source, ctx) ?? '');
      try {
        return src.replace(new RegExp(spec.regexReplace.pattern, spec.regexReplace.flags || ''), spec.regexReplace.replacement || '');
      } catch {
        return src;
      }
    }

    if (spec.excludeIfIncludes) {
      const src = String(resolveRef(spec.excludeIfIncludes.source, ctx) ?? '');
      const needles = spec.excludeIfIncludes.needles || [];
      if (needles.some(n => src.includes(n))) return '';
      return src;
    }

    if (spec.helper) {
      const name = typeof spec.helper === 'string' ? spec.helper : spec.helper.name;
      const args = {};
      const raw = spec.args || {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          args[k] = runOne(v, document, location, ctx, options);
        } else {
          args[k] = resolveRef(v, ctx);
        }
      }
      return SyncrEngineHelpers.run(name, args, document, location);
    }

    if (spec.jsonPath) {
      const from = resolveRef(spec.from, ctx);
      if (!from) return '';
      return jsonPathSimple(spec.jsonPath, from);
    }

    if (spec.fetchJson) {
      return { __asyncFetch: spec.fetchJson };
    }

    return null;
  }

  function jsonPathSimple(path, data) {
    if (!path || !data) return '';
    if (path === '$') return data;
    const clean = path.replace(/^\$\.?/, '');
    const parts = clean.split('.');
    let cur = data;
    for (const p of parts) {
      if (cur == null) return '';
      cur = cur[p];
    }
    return cur ?? '';
  }

  async function runAll(extractDef, document, location, baseCtx, options) {
    if (!extractDef || typeof extractDef !== 'object') return { ...baseCtx };

    const ctx = { ...baseCtx };

    for (let pass = 0; pass < 4; pass++) {
      for (const [name, spec] of Object.entries(extractDef)) {
        if (pass > 0 && ctx[name] !== undefined && ctx[name] !== null && ctx[name] !== '') continue;
        const result = runOne(spec, document, location, ctx, options);
        if (result && result.__asyncFetch) continue;
        if (!isEmpty(result) || spec?.literal === '' || spec?.literal === null) {
          ctx[name] = result;
        }
      }
    }

    const pending = [];
    for (const [name, spec] of Object.entries(extractDef)) {
      const result = runOne(spec, document, location, ctx, options);
      if (result && result.__asyncFetch) {
        pending.push(
          SyncrEngineFetch.fetchJson(result.__asyncFetch, ctx, options).then(data => {
            ctx[name] = data;
          }),
        );
      }
    }

    if (pending.length) await Promise.all(pending);

    for (let pass = 0; pass < 2; pass++) {
      for (const [name, spec] of Object.entries(extractDef)) {
        if (runOne(spec, document, location, ctx, options)?.__asyncFetch) continue;
        const result = runOne(spec, document, location, ctx, options);
        if (result && !result.__asyncFetch && !isEmpty(result)) {
          ctx[name] = result;
        }
      }
    }

    return ctx;
  }

  function checkRequired(required, ctx) {
    if (!required?.length) return true;
    for (const k of required) {
      const v = ctx[k];
      if (isEmpty(v)) return false;
      if (typeof v === 'object' && v !== null && v.currentTime == null && !Array.isArray(v)) {
        if (Object.keys(v).length === 0) return false;
      }
    }
    return true;
  }

  return { runOne, runAll, checkRequired, isEmpty, resolveRef };
})();
