'use strict';

const SyncrEngine = (function () {
  const ENGINE_VERSION = '2.0.0';
  const MAX_RULES = 64;

  function resolveEmitV1(emit, location) {
    const loc = location || (typeof window !== 'undefined' ? window.location : { href: '', origin: '', pathname: '' });
    if (!emit || typeof emit !== 'object') return emit;
    const out = {};
    for (const [k, v] of Object.entries(emit)) {
      out[k] = SyncrEngineEmit.resolveTemplateValue(v, {
        url:    loc.href || '',
        origin: loc.origin || '',
        path:   loc.pathname || '',
      });
    }
    return out;
  }

  function evaluateV1(def, document, location) {
    for (const rule of def.rules || []) {
      if (SyncrEngineWhen.evalWhen(rule.when, document, location, {})) {
        return resolveEmitV1(rule.emit, location);
      }
    }
    if (def.default) {
      if (def.default.emit) return resolveEmitV1(def.default.emit, location);
      return resolveEmitV1(def.default, location);
    }
    return null;
  }

  async function runRule(rule, document, location, baseCtx, options) {
    if (!SyncrEngineWhen.evalWhen(rule.when, document, location, baseCtx)) return null;

    let ctx = baseCtx;
    if (rule.extract) {
      ctx = await SyncrEngineExtract.runAll(rule.extract, document, location, baseCtx, options);
    }

    if (rule.require && !SyncrEngineExtract.checkRequired(
      Array.isArray(rule.require) ? rule.require : [rule.require],
      ctx,
    )) {
      return null;
    }

    if (rule.run) {
      const helperName = rule.run.helper;
      const args = { pageUrl: ctx.url };
      for (const [k, v] of Object.entries(rule.run.args || {})) {
        if (k === 'meta') { args.meta = ctx.meta; continue; }
        if (typeof v === 'string' && v.startsWith('{')) {
          args[k] = SyncrEngineExtract.resolveRef(v, ctx);
        } else {
          args[k] = ctx[k] ?? v;
        }
      }
      const result = SyncrEngineHelpers.run(helperName, args, document, location);
      if (result) return result;
      return null;
    }

    if (!rule.emit) return null;
    return SyncrEngineEmit.resolveEmit(rule.emit, ctx);
  }

  async function evaluateRules(rules, document, location, baseCtx, options) {
    const list = (rules || []).slice(0, MAX_RULES);
    for (const rule of list) {
      const result = await runRule(rule, document, location, baseCtx, options);
      if (result) return result;
    }
    return null;
  }

  async function evaluate(def, document, location, options = {}) {
    if (!def) return null;

    const loc = location || (typeof window !== 'undefined' ? window.location : { href: '', origin: '', pathname: '', hostname: '', search: '', hash: '' });
    const doc = document || (typeof window !== 'undefined' ? window.document : null);
    if (!doc) return null;

    const version = def.version ?? 1;
    if (version < 2) return evaluateV1(def, doc, loc);

    const baseCtx = {
      ...SyncrEngineContext.buildBase(loc),
      ...options.extraCtx,
    };

    const opts = {
      fetchOrigins: options.fetchOrigins || [],
      activityId:   options.activityId || 'unknown',
    };

    if (def.profiles?.length) {
      for (const profile of def.profiles) {
        if (SyncrEngineWhen.evalWhen(profile.when, doc, loc, baseCtx)) {
          const result = await evaluateRules(profile.rules, doc, loc, baseCtx, opts);
          if (result) return result;
        }
      }
    }

    let result = await evaluateRules(def.rules, doc, loc, baseCtx, opts);
    if (result) return result;

    if (def.fallback) {
      const missing = def.fallback.whenMissing || [];
      const allMissing = missing.every(k => SyncrEngineExtract.isEmpty(baseCtx[k]));
      if (allMissing || !missing.length) {
        if (def.fallback.extract) {
          const ctx = await SyncrEngineExtract.runAll(def.fallback.extract, doc, loc, baseCtx, opts);
          return SyncrEngineEmit.resolveEmit(def.fallback.emit, ctx);
        }
        if (def.fallback.emit) return SyncrEngineEmit.resolveEmit(def.fallback.emit, baseCtx);
      }
    }

    if (def.default?.emit) return SyncrEngineEmit.resolveEmit(def.default.emit, baseCtx);
    if (def.default && !def.default.emit) return resolveEmitV1(def.default, loc);

    return null;
  }

  return {
    ENGINE_VERSION,
    evaluate,
    evaluateV1,
    SyncrEngineWhen,
    SyncrEngineExtract,
    SyncrEngineEmit,
    SyncrEngineFetch,
    SyncrEngineHelpers,
    SyncrEngineChangeDetection,
    SyncrEngineContext,
  };
})();

if (typeof window !== 'undefined') {
  window.SyncrEngine = SyncrEngine;
}
