'use strict';

const SyncrEngineWhen = (function () {
  function getPath(location) {
    return (location.pathname || '').toLowerCase();
  }

  function hashParams(location) {
    const raw = (location.hash || '').replace(/^#/, '');
    if (!raw) return new URLSearchParams();
    try { return new URLSearchParams(raw); } catch { return new URLSearchParams(); }
  }

  function searchParams(location) {
    return new URLSearchParams(location.search || '');
  }

  function evalWhen(when, document, location, ctx) {
    if (!when) return true;

    if (when.not) return !evalWhen(when.not, document, location, ctx);
    if (when.any) return when.any.some(w => evalWhen(w, document, location, ctx));
    if (when.all) return when.all.every(w => evalWhen(w, document, location, ctx));

    if (when.hostnameIncludes) {
      const h = (location.hostname || '').toLowerCase();
      const list = Array.isArray(when.hostnameIncludes) ? when.hostnameIncludes : [when.hostnameIncludes];
      if (!list.some(s => h.includes(String(s).toLowerCase()))) return false;
    }

    if (when.pathIncludes) {
      const path = getPath(location);
      const list = Array.isArray(when.pathIncludes) ? when.pathIncludes : [when.pathIncludes];
      if (!list.some(s => path.includes(String(s).toLowerCase()))) return false;
    }

    if (when.pathRegex) {
      const re = new RegExp(when.pathRegex, when.pathRegexFlags || 'i');
      if (!re.test(location.pathname || '')) return false;
    }

    if (when.searchParam) {
      const sp = searchParams(location);
      for (const [key, val] of Object.entries(when.searchParam)) {
        const got = sp.get(key);
        if (val === '*' ? !got : got !== val) return false;
      }
    }

    if (when.hashParam) {
      const hp = hashParams(location);
      for (const [key, val] of Object.entries(when.hashParam)) {
        const got = hp.get(key);
        if (val === '*' ? !got : got !== val) return false;
      }
    }

    if (when.hashParamAny) {
      const hp = hashParams(location);
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

    if (when.selectorTextIncludes) {
      const cfg = when.selectorTextIncludes;
      const sel = typeof cfg === 'string' ? cfg : cfg.selector;
      const inc = typeof cfg === 'string' ? '' : (cfg.includes || '');
      const el = document.querySelector(sel);
      if (!el || !el.textContent.toLowerCase().includes(String(inc).toLowerCase())) return false;
    }

    if (when.pathSegmentAfter) {
      const segments = getPath(location).split('/').filter(Boolean);
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

    if (when.urlParamExists) {
      const keys = Array.isArray(when.urlParamExists) ? when.urlParamExists : [when.urlParamExists];
      const sp = searchParams(location);
      if (!keys.some(k => sp.get(k))) return false;
    }

    if (when.require) {
      const keys = Array.isArray(when.require) ? when.require : [when.require];
      for (const k of keys) {
        const v = ctx?.[k];
        if (v == null || v === '') return false;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          if (Object.keys(v).length === 0) return false;
        }
      }
    }

    if (when.extractEquals) {
      const { ref, value } = when.extractEquals;
      if (ctx?.[ref] !== value) return false;
    }

    return true;
  }

  return { evalWhen, getPath, hashParams, searchParams };
})();
