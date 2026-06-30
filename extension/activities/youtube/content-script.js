/**
 * Syncr content script: YouTube (www.youtube.com)
 *
 * Only activates on /watch pages. Uses the <video> element for accurate
 * play/pause and timing state. Derives thumbnail from the video ID in the URL.
 */

(function () {
  'use strict';

  const ACTIVITY_ID      = 'youtube';
  const POLL_MS          = 2000;
  const SEEK_THRESHOLD_S = 5;

  // Can be null (nothing sent yet), 'browsing', or a video data object.
  let lastSent = null;
  let sentAt   = 0;
  let sentPos  = 0;

  // ---------------------------------------------------------------------------
  // Scrape
  // ---------------------------------------------------------------------------

  function scrape() {
    // Not on a watch page — browsing mode
    if (!window.location.pathname.startsWith('/watch')) {
      return { browsing: true };
    }

    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId) return { browsing: true };

    // Video element for reliable timing + pause state
    const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
    if (!video || video.readyState < 2) return null;

    // Title — try the primary heading, then the tab title as fallback
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                    document.querySelector('ytd-watch-metadata h1 yt-formatted-string') ||
                    document.querySelector('#above-the-fold #title h1');
    const title = titleEl?.textContent.trim() ||
                  document.title.replace(' - YouTube', '').trim() ||
                  'Unknown Video';

    // Channel name + URL
    const channelEl = document.querySelector('ytd-channel-name a') ||
                      document.querySelector('#channel-name a') ||
                      document.querySelector('#owner #channel-name a');
    const channelName = channelEl?.textContent.trim() || '';
    const channelUrl  = channelEl?.href?.split('?')[0] || '';

    // Thumbnail via YouTube's image CDN — no DOM scraping needed
    const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

    const paused      = video.paused;
    const currentTime = video.currentTime;
    const duration    = isFinite(video.duration) && video.duration > 0 ? video.duration : 0;

    return {
      title,
      channelName,
      channelUrl,
      thumbnailUrl,
      currentTime,
      duration,
      paused,
      pageUrl: window.location.href,
    };
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  function poll() {
    const data = scrape();

    // Browsing — not on a watch page
    if (data?.browsing) {
      if (lastSent !== 'browsing') {
        lastSent = 'browsing';
        sentAt = 0; sentPos = 0;
        browser.runtime.sendMessage({
          type: 'activity:update', activityId: ACTIVITY_ID,
          data: { browsing: true },
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

    const isNew     = !lastSent || lastSent === 'browsing';
    const titleChg  = isNew || lastSent?.title       !== data.title;
    const chanChg   = isNew || lastSent?.channelName !== data.channelName;
    const pauseChg  = isNew || lastSent?.paused      !== data.paused;

    let seeked = false;
    if (lastSent && !lastSent.paused) {
      const expected = sentPos + (Date.now() - sentAt) / 1000;
      seeked = Math.abs(data.currentTime - expected) > SEEK_THRESHOLD_S;
    }

    if (!isNew && !titleChg && !chanChg && !pauseChg && !seeked) return;

    lastSent = { title: data.title, channelName: data.channelName, paused: data.paused };
    sentAt   = Date.now();
    sentPos  = data.currentTime;

    browser.runtime.sendMessage({
      type:       'activity:update',
      activityId: ACTIVITY_ID,
      data,
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  let intervalId = setInterval(poll, POLL_MS);

  // Re-poll immediately on SPA navigation (YouTube uses pushState).
  // Resetting lastSent forces a fresh send regardless of whether data changed.
  window.addEventListener('yt-navigate-finish', () => {
    lastSent = null;
    poll();
  });

  window.addEventListener('unload', () => {
    clearInterval(intervalId);
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  });

  poll();
})();
