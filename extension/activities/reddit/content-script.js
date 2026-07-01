/**
 * Syncr content script: Reddit (www.reddit.com / old.reddit.com)
 *
 * Post pages send rich metadata from shreddit-post attributes or old Reddit DOM.
 * Feed, subreddit, profile, and search pages use browsing mode with context.
 */

(function () {
  'use strict';

  const ACTIVITY_ID = 'reddit';
  const POLL_MS     = 2000;

  let lastSent = null;
  let lastUrl  = window.location.href;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function isOldReddit() {
    return !!(document.querySelector('.default-header') || document.querySelector('#header'));
  }

  function subredditFromPath(pathname) {
    const m = pathname.match(/^\/r\/([^/]+)/);
    return m ? `r/${m[1]}` : null;
  }

  function userFromPath(pathname) {
    const m = pathname.match(/^\/user\/([^/]+)/);
    return m ? `u/${m[1]}` : null;
  }

  function isPostPage(pathname) {
    return /\/r\/[^/]+\/comments\/[^/]+/.test(pathname);
  }

  function absRedditUrl(path) {
    if (!path) return '';
    if (path.startsWith('https://')) return path;
    return `https://www.reddit.com${path.startsWith('/') ? path : `/${path}`}`;
  }

  function ogImage() {
    const og = document.querySelector('meta[property="og:image"]')?.content || '';
    if (!og || og.includes('redditstatic.com/avatar') || og.includes('styles.redditmedia')) return '';
    return og;
  }

  function browsingContext(pathname) {
    const sub = subredditFromPath(pathname) ||
      document.querySelector('shreddit-subreddit-header')?.getAttribute('prefixed-name');
    if (sub) return sub;

    const user = userFromPath(pathname);
    if (user) return user;

    if (pathname.startsWith('/search')) {
      const q = new URLSearchParams(window.location.search).get('q');
      return q ? `Search: ${q}` : 'Search';
    }

    if (pathname.startsWith('/rpan')) return 'RPAN';

    return 'Home';
  }

  // ---------------------------------------------------------------------------
  // Scrape — new Reddit (shreddit web components)
  // ---------------------------------------------------------------------------

  function scrapeNewReddit() {
    const { pathname, href } = window.location;

    if (isPostPage(pathname)) {
      const post = document.querySelector('shreddit-post[is-post-detail-page]') ||
                   document.querySelector('article shreddit-post') ||
                   document.querySelector('shreddit-post[post-title]') ||
                   document.querySelector('shreddit-post');

      const titleAttr = post?.getAttribute('post-title');
      const titleEl   = document.querySelector('shreddit-title') ||
                        document.querySelector('[slot="title"]') ||
                        document.querySelector('h1[slot="title"]');
      const title = titleAttr ||
                    titleEl?.getAttribute('title') ||
                    titleEl?.textContent?.trim() ||
                    document.querySelector('h1')?.textContent?.trim();

      if (!title) return null;

      const author    = (post?.getAttribute('author') || '').replace(/^u\//, '');
      const score     = post?.getAttribute('score') || '';
      const comments  = post?.getAttribute('comment-count') || '';
      const subreddit = post?.getAttribute('subreddit-prefixed-name') ||
                        document.querySelector('shreddit-subreddit-header')?.getAttribute('prefixed-name') ||
                        subredditFromPath(pathname) || '';
      const permalink   = post?.getAttribute('permalink') || '';
      const postType    = post?.getAttribute('post-type') || '';
      const contentHref = post?.getAttribute('content-href') || '';
      const pageUrl     = permalink ? absRedditUrl(permalink) : href;
      const subredditUrl = subreddit ? absRedditUrl(`/${subreddit}`) : '';
      const authorUrl    = author ? absRedditUrl(`/user/${author}`) : '';

      let thumbnailUrl = post?.getAttribute('icon') ||
                         post?.getAttribute('thumbnail-url') ||
                         ogImage();

      if (thumbnailUrl && (thumbnailUrl === 'self' || thumbnailUrl === 'default' || thumbnailUrl === 'nsfw')) {
        thumbnailUrl = ogImage();
      }

      return {
        title,
        author,
        authorUrl,
        subreddit,
        subredditUrl,
        score,
        comments,
        postType,
        contentHref,
        thumbnailUrl,
        pageUrl,
      };
    }

    return { browsing: true, browsingContext: browsingContext(pathname) };
  }

  // ---------------------------------------------------------------------------
  // Scrape — old Reddit
  // ---------------------------------------------------------------------------

  function scrapeOldReddit() {
    const { pathname, href } = window.location;

    const subEl = document.querySelector('.redditname');
    const subreddit = subEl?.textContent?.trim()
      ? `r/${subEl.textContent.trim()}`
      : subredditFromPath(pathname) || '';

    if (pathname.includes('/comments/')) {
      const title = document.querySelector('p.title > a')?.textContent?.trim() ||
                    document.querySelector('a.title')?.textContent?.trim();
      if (!title) return null;

      const authorRaw = document.querySelector('.tagline .author')?.textContent?.trim() || '';
      const author    = authorRaw.replace(/^u\//, '');
      const scoreEl   = document.querySelector('.score.unvoted, .score.likes');
      const score     = scoreEl?.textContent?.trim().replace(/ points?$/i, '') || '';
      const comments  = document.querySelector('.comments')?.textContent?.trim().replace(/\D/g, '') || '';
      const subredditUrl = subreddit ? absRedditUrl(`/${subreddit}`) : '';
      const authorUrl    = author ? absRedditUrl(`/user/${author}`) : '';

      return {
        title,
        author,
        authorUrl,
        subreddit,
        subredditUrl,
        score,
        comments,
        postType:    '',
        contentHref: '',
        thumbnailUrl: ogImage() || document.querySelector('.thumbnail img')?.src || '',
        pageUrl:     href,
      };
    }

    if (pathname.startsWith('/user/')) {
      const name = document.querySelector('.titlebox > h1')?.textContent?.trim() ||
                   userFromPath(pathname);
      return { browsing: true, browsingContext: name || 'Profile' };
    }

    if (pathname.startsWith('/search')) {
      const q = new URLSearchParams(window.location.search).get('q');
      return { browsing: true, browsingContext: q ? `Search: ${q}` : 'Search' };
    }

    return { browsing: true, browsingContext: subreddit || 'Home' };
  }

  // ---------------------------------------------------------------------------
  // Scrape
  // ---------------------------------------------------------------------------

  function scrape() {
    return isOldReddit() ? scrapeOldReddit() : scrapeNewReddit();
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

    if (data?.browsing) {
      const ctx = data.browsingContext || 'Home';
      if (lastSent?.mode !== 'browsing' || lastSent?.browsingContext !== ctx) {
        lastSent = { mode: 'browsing', browsingContext: ctx };
        browser.runtime.sendMessage({
          type: 'activity:update', activityId: ACTIVITY_ID,
          data: { browsing: true, browsingContext: ctx },
        }).catch(() => {});
      }
      return;
    }

    if (!data) {
      if (lastSent !== null) {
        lastSent = null;
        browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
      }
      return;
    }

    const isNew = !lastSent || lastSent.mode === 'browsing';
    const changed = isNew ||
      lastSent.title     !== data.title ||
      lastSent.author    !== data.author ||
      lastSent.subreddit !== data.subreddit ||
      lastSent.score     !== data.score ||
      lastSent.comments  !== data.comments;

    if (!changed) return;

    lastSent = {
      mode: 'post',
      title: data.title,
      author: data.author,
      subreddit: data.subreddit,
      score: data.score,
      comments: data.comments,
    };

    browser.runtime.sendMessage({
      type:       'activity:update',
      activityId: ACTIVITY_ID,
      data,
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

  window.addEventListener('unload', () => {
    clearInterval(intervalId);
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  });

  poll();
})();
