/**
 * Syncr content script: Proton Mail (mail.proton.me / mail.protonmail.com)
 *
 * Privacy-first: only detects structural page state (compose, folder, message view).
 * Never reads email subjects, senders, body text, or addresses.
 */

(function () {
  'use strict';

  const ACTIVITY_ID = 'proton-mail';
  const POLL_MS     = 2000;

  let lastSent = null;
  let lastUrl  = window.location.href;

  const COMPOSER_SELECTORS = [
    '[data-testid="composer"]',
    '.composer-container',
    '.proton-mail-composer',
    '.composer--container',
  ].join(', ');

  const MESSAGE_VIEW_SELECTORS = [
    '[data-testid="message-view"]:not([hidden])',
    '[data-testid="conversation-view"]:not([hidden])',
    '.message-view:not([hidden])',
  ].join(', ');

  // ---------------------------------------------------------------------------
  // Detection — URL + layout only, no PII
  // ---------------------------------------------------------------------------

  function hashParams() {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return new URLSearchParams();
    try { return new URLSearchParams(raw); } catch { return new URLSearchParams(); }
  }

  function isComposerOpen() {
    return !!document.querySelector(COMPOSER_SELECTORS);
  }

  function isMessageViewOpen() {
    const hp = hashParams();
    if (hp.get('elementID') || hp.get('messageID')) return true;

    const path = window.location.pathname.toLowerCase();
    const segments = path.split('/').filter(Boolean);

    const mailFolders = [
      'inbox', 'drafts', 'sent', 'starred', 'archive', 'spam', 'trash',
      'all-mail', 'almost-all-mail', 'all-drafts', 'all-sent',
    ];

    for (const folder of mailFolders) {
      const idx = segments.indexOf(folder);
      if (idx >= 0 && segments.length > idx + 1) return true;
    }

    return !!document.querySelector(MESSAGE_VIEW_SELECTORS);
  }

  function folderContext(path) {
    if (path.includes('/all-drafts') || path.includes('/drafts')) return 'Browsing drafts';
    if (path.includes('/all-sent')   || path.includes('/sent'))    return 'Browsing sent mail';
    if (path.includes('/starred'))                                 return 'Browsing starred mail';
    if (path.includes('/archive'))                                 return 'Browsing archive';
    if (path.includes('/spam'))                                    return 'Browsing spam';
    if (path.includes('/trash'))                                   return 'Browsing trash';
    if (path.includes('/all-mail') || path.includes('/almost-all-mail')) return 'Browsing all mail';
    if (path.includes('/newsletters'))                             return 'Browsing newsletters';
    if (path.includes('/inbox'))                                   return 'Browsing inbox';
    return 'Browsing emails';
  }

  function scrape() {
    if (!window.location.hostname.includes('proton')) return null;

    if (isComposerOpen()) {
      return { mode: 'drafting', context: 'Drafting an email' };
    }

    if (isMessageViewOpen()) {
      return { mode: 'viewing', context: 'Viewing an email' };
    }

    const path = window.location.pathname.toLowerCase();
    if (path.includes('/u/')) {
      return { mode: 'browsing', context: folderContext(path) };
    }

    return { mode: 'browsing', context: 'Browsing emails' };
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  function poll() {
    if (window.location.href !== lastUrl) {
      lastUrl  = window.location.href;
      lastSent = null;
    }

    const data = scrape();
    if (!data) {
      if (lastSent !== null) {
        lastSent = null;
        browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
      }
      return;
    }

    if (lastSent?.mode === data.mode && lastSent?.context === data.context) return;

    lastSent = { mode: data.mode, context: data.context };

    browser.runtime.sendMessage({
      type:       'activity:update',
      activityId: ACTIVITY_ID,
      data: {
        mode:    data.mode,
        context: data.context,
        pageUrl: 'https://mail.proton.me/',
      },
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

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
