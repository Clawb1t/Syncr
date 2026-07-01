/**
 * Syncr content script: Netflix (www.netflix.com)
 *
 * Browsing, search, title pages, and watch pages with season/episode metadata
 * from Netflix's member API (same origin, credentials included).
 */

(function () {
  'use strict';

  const ACTIVITY_ID      = 'netflix';
  const POLL_MS          = 2000;
  const SEEK_THRESHOLD_S = 5;
  const METADATA_URL     = 'https://www.netflix.com/nq/website/memberapi/release/metadata?movieid=';

  let lastSent     = null;
  let lastUrl      = window.location.href;
  let sentAt       = 0;
  let sentPos      = 0;
  let scrapeBusy   = false;
  let metadataCache = { id: null, data: null };

  // ---------------------------------------------------------------------------
  // Metadata API
  // ---------------------------------------------------------------------------

  async function fetchMetadata(movieId) {
    if (!movieId) return null;
    if (metadataCache.id === movieId && metadataCache.data) return metadataCache.data;

    try {
      const res = await fetch(`${METADATA_URL}${movieId}`, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      metadataCache = { id: movieId, data };
      return data;
    } catch {
      return null;
    }
  }

  function findEpisode(video) {
    const target = video.currentEpisode;
    for (const season of video.seasons || []) {
      for (const episode of season.episodes || []) {
        if (episode.episodeId === target || episode.id === target) {
          return { season, episode };
        }
      }
    }
    return { season: null, episode: null };
  }

  function pickThumbnail(video, episode) {
    const still = episode?.stills?.[0]?.url || episode?.thumbs?.[0]?.url;
    if (still) return still;
    const box = video.boxart?.[0]?.url || video.storyart?.[0]?.url || video.artwork?.[0]?.url;
    return box || '';
  }

  function seriesUrl(video) {
    if (!video?.id) return '';
    return `https://www.netflix.com/title/${video.id}`;
  }

  // ---------------------------------------------------------------------------
  // Scrape helpers
  // ---------------------------------------------------------------------------

  function watchIdFromUrl() {
    const m = window.location.pathname.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  }

  function titleIdFromUrl() {
    const pathMatch = window.location.pathname.match(/\/title\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return new URLSearchParams(window.location.search).get('jbv') || null;
  }

  function searchQueryFromUrl() {
    if (!window.location.pathname.includes('/search')) return null;
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || params.get('query') || params.get('keyword') || null;
  }

  function browsingContext() {
    const path = window.location.pathname;
    if (path === '/' || path === '/browse') return 'Netflix';
    const genre = path.match(/^\/browse\/genre\/(\d+)/);
    if (genre) return 'Browse';
    if (path.startsWith('/latest')) return 'Latest';
    if (path.startsWith('/my-list')) return 'My List';
    return 'Netflix';
  }

  function buildPreview(meta, pageUrl) {
    const video = meta?.video;
    if (!video?.title) return null;

    return {
      mode:         'preview',
      title:        video.title,
      synopsis:     video.synopsis || '',
      thumbnailUrl: pickThumbnail(video),
      mediaType:    video.type === 'show' ? 'show' : 'movie',
      pageUrl,
      seriesUrl:    video.type === 'show' ? seriesUrl(video) : '',
      year:         video.year || null,
      runtimeMinutes: video.displayRuntime || video.runtime || null,
    };
  }

  function buildWatching(meta, videoEl, pageUrl) {
    const video = meta?.video;
    if (!video?.title) return null;

    const paused      = videoEl.paused;
    const currentTime = videoEl.currentTime;
    const duration    = isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0;

    const base = {
      mode:         'watching',
      title:        video.title,
      thumbnailUrl: pickThumbnail(video),
      mediaType:    video.type === 'show' ? 'show' : 'movie',
      paused,
      currentTime,
      duration,
      pageUrl,
      seriesUrl:    video.type === 'show' ? seriesUrl(video) : '',
    };

    if (video.type === 'show') {
      const { season, episode } = findEpisode(video);
      base.thumbnailUrl = pickThumbnail(video, episode) || base.thumbnailUrl;
      base.seasonNumber  = season?.seq ?? null;
      base.episodeNumber = episode?.seq ?? null;
      base.episodeTitle  = episode?.title || '';
      base.episodeSynopsis = episode?.synopsis || '';
    } else {
      base.year            = video.year || null;
      base.runtimeMinutes  = video.displayRuntime || video.runtime || null;
    }

    return base;
  }

  // ---------------------------------------------------------------------------
  // Scrape
  // ---------------------------------------------------------------------------

  async function scrape() {
    const { href, pathname } = window.location;

    const searchQuery = searchQueryFromUrl();
    if (searchQuery) {
      return { mode: 'search', searchQuery };
    }

    const watchId = watchIdFromUrl();
    if (watchId) {
      const videoEl = document.querySelector('video');
      if (!videoEl || videoEl.readyState < 2) return null;

      const meta = await fetchMetadata(watchId);
      return buildWatching(meta, videoEl, href);
    }

    const titleId = titleIdFromUrl();
    if (titleId) {
      const meta = await fetchMetadata(titleId);
      return buildPreview(meta, href);
    }

    return { mode: 'browsing', browsing: true, browsingContext: browsingContext() };
  }

  // ---------------------------------------------------------------------------
  // Poll
  // ---------------------------------------------------------------------------

  function sendUpdate(data) {
    browser.runtime.sendMessage({
      type:       'activity:update',
      activityId: ACTIVITY_ID,
      data,
    }).catch(() => {});
  }

  function sendClear() {
    browser.runtime.sendMessage({ type: 'activity:clear', activityId: ACTIVITY_ID }).catch(() => {});
  }

  function trackSent(data) {
    lastSent = {
      mode:           data.mode,
      browsingContext: data.browsingContext,
      searchQuery:    data.searchQuery,
      title:          data.title,
      mediaType:      data.mediaType,
      seasonNumber:   data.seasonNumber,
      episodeNumber:  data.episodeNumber,
      episodeTitle:   data.episodeTitle,
      paused:         data.paused,
    };
    if (data.mode === 'watching') {
      sentAt  = Date.now();
      sentPos = data.currentTime;
    } else {
      sentAt = 0;
      sentPos = 0;
    }
  }

  async function poll() {
    if (scrapeBusy) return;
    scrapeBusy = true;

    try {
      if (window.location.href !== lastUrl) {
        lastUrl  = window.location.href;
        lastSent = null;
        metadataCache = { id: null, data: null };
      }

      const data = await scrape();

      if (data?.browsing) {
        const ctx = data.browsingContext || 'Netflix';
        if (lastSent?.mode !== 'browsing' || lastSent?.browsingContext !== ctx) {
          trackSent(data);
          sendUpdate({ browsing: true, browsingContext: ctx });
        }
        return;
      }

      if (data?.mode === 'search') {
        if (lastSent?.mode !== 'search' || lastSent?.searchQuery !== data.searchQuery) {
          trackSent(data);
          sendUpdate({ mode: 'search', searchQuery: data.searchQuery });
        }
        return;
      }

      if (!data) {
        if (lastSent !== null) {
          lastSent = null;
          sendClear();
        }
        return;
      }

      const isNew = !lastSent || lastSent.mode !== data.mode;

      if (data.mode === 'preview') {
        const changed = isNew ||
          lastSent.title     !== data.title ||
          lastSent.mediaType !== data.mediaType;
        if (!changed) return;
        trackSent(data);
        sendUpdate(data);
        return;
      }

      if (data.mode === 'watching') {
        const titleChg  = isNew || lastSent.title         !== data.title;
        const epChg     = isNew || lastSent.episodeTitle  !== data.episodeTitle ||
                          lastSent.seasonNumber  !== data.seasonNumber ||
                          lastSent.episodeNumber !== data.episodeNumber;
        const pauseChg  = isNew || lastSent.paused        !== data.paused;

        let seeked = false;
        if (lastSent?.mode === 'watching' && !lastSent.paused) {
          const expected = sentPos + (Date.now() - sentAt) / 1000;
          seeked = Math.abs(data.currentTime - expected) > SEEK_THRESHOLD_S;
        }

        if (!isNew && !titleChg && !epChg && !pauseChg && !seeked) return;

        trackSent(data);
        sendUpdate(data);
      }
    } finally {
      scrapeBusy = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  const intervalId = setInterval(poll, POLL_MS);

  window.addEventListener('popstate', () => {
    lastSent = null;
    metadataCache = { id: null, data: null };
    poll();
  });

  window.addEventListener('unload', () => {
    clearInterval(intervalId);
    sendClear();
  });

  poll();
})();
