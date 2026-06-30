/**
 * Syncr content script: YouTube Music (music.youtube.com)
 *
 * Polls the YTM player DOM every 2 s and forwards structured activity data
 * to the background script via browser.runtime.sendMessage.
 *
 * We use the <video> element for pause/time state — it is far more reliable
 * than scraping aria-labels or the time-display text nodes.
 */

(function () {
  'use strict';

  const ACTIVITY_ID      = 'youtube-music';
  const POLL_MS          = 2000;
  // Re-send if the playhead differs from our predicted position by this many
  // seconds — indicates the user has seeked.
  const SEEK_THRESHOLD_S = 5;

  // Last snapshot we actually sent to the background.
  // Can be null (nothing sent yet), 'browsing', or a song data object.
  let lastSent = null;
  let sentAt   = 0;         // Date.now() when we sent it
  let sentPos  = 0;         // currentTime at time of send

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function parseSubtitle(text) {
    const parts = (text || '').split(' • ');
    return parts.length >= 2
      ? { artist: parts[0].trim(), album: parts[1].trim() }
      : { artist: (text || '').trim(), album: '' };
  }

  // ---------------------------------------------------------------------------
  // Scrape
  // ---------------------------------------------------------------------------

  function scrape() {
    // Song title
    const titleEl = document.querySelector('.title.ytmusic-player-bar');
    if (!titleEl?.textContent.trim()) return null;
    const title = titleEl.textContent.trim();

    // Artist / album
    const subtitleEl = document.querySelector('.subtitle.ytmusic-player-bar');
    const { artist, album } = parseSubtitle(subtitleEl?.textContent);

    // Album art
    const imgEl = document.querySelector('img.ytmusic-player-bar');
    const albumArt = (imgEl?.src || '').replace(/=w\d+-h\d+.*$/, '=w500-h500');

    // Use the <video> element for reliable play/pause + timing
    const video = document.querySelector('video');
    if (!video || video.readyState < 2) return null;

    const paused      = video.paused;
    const currentTime = video.currentTime;
    const duration    = isFinite(video.duration) && video.duration > 0
                          ? video.duration
                          : 0;

    return { title, artist, album, albumArt, currentTime, duration, paused,
             pageUrl: window.location.href };
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  function poll() {
    const data = scrape();

    if (!data) {
      // No song loaded — show a "browsing" presence instead of clearing entirely.
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

    // Detect meaningful changes only — avoid hammering RPC every 2 s
    const isNew      = !lastSent || lastSent === 'browsing';
    const titleChg   = lastSent?.title    !== data.title;
    const artistChg  = lastSent?.artist   !== data.artist;
    const pauseChg   = lastSent?.paused   !== data.paused;
    // Track albumArt separately: YTM lazy-swaps the image after the title
    // updates, so the first poll on a song change may capture the old art.
    // Tracking it here means the following poll will detect the change and
    // send a corrective update once the new image has loaded into the DOM.
    const artChg     = lastSent?.albumArt !== data.albumArt;

    // Did the user seek? Compare real position vs where we'd expect based on
    // elapsed time since the last send.
    let seeked = false;
    if (lastSent && !lastSent.paused) {
      const expected = sentPos + (Date.now() - sentAt) / 1000;
      seeked = Math.abs(data.currentTime - expected) > SEEK_THRESHOLD_S;
    }

    if (!isNew && !titleChg && !artistChg && !pauseChg && !artChg && !seeked) return;

    // Snapshot what we're sending
    lastSent = { title: data.title, artist: data.artist, album: data.album, albumArt: data.albumArt, paused: data.paused };
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

  const intervalId = setInterval(poll, POLL_MS);

  window.addEventListener('yt-navigate-finish', () => { lastSent = null; poll(); });

  window.addEventListener('unload', () => {
    clearInterval(intervalId);
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  });

  poll();
})();
