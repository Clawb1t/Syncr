'use strict';

const SyncrEngineContext = (function () {
  const MAX_STRING = 512;

  function truncate(s, max = MAX_STRING) {
    if (s == null) return '';
    const str = String(s);
    return str.length <= max ? str : str.slice(0, max - 1) + '\u2026';
  }

  function buildBase(location) {
    const loc = location || (typeof window !== 'undefined' ? window.location : { href: '', origin: '', pathname: '' });
    return {
      url:    loc.href || '',
      origin: loc.origin || '',
      path:   (loc.pathname || '').toLowerCase(),
      href:   loc.href || '',
    };
  }

  return { buildBase, truncate, MAX_STRING };
})();
