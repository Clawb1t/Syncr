'use strict';

const SyncrEngineHelpers = (function () {
  function findEpisode(video) {
    const target = video?.currentEpisode;
    for (const season of video?.seasons || []) {
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
    const box = video?.boxart?.[0]?.url || video?.storyart?.[0]?.url || video?.artwork?.[0]?.url;
    return box || '';
  }

  function seriesUrl(video) {
    if (!video?.id) return '';
    return `https://www.netflix.com/title/${video.id}`;
  }

  function browsingContext(pathname) {
    const path = pathname || '';
    if (path === '/' || path === '/browse') return 'Netflix';
    if (/^\/browse\/genre\/\d+/.test(path)) return 'Browse';
    if (path.startsWith('/latest')) return 'Latest';
    if (path.startsWith('/my-list')) return 'My List';
    return 'Netflix';
  }

  function buildPreview(meta, pageUrl) {
    const video = meta?.video;
    if (!video?.title) return null;
    return {
      mode:           'preview',
      title:          video.title,
      synopsis:       video.synopsis || '',
      thumbnailUrl:   pickThumbnail(video),
      mediaType:      video.type === 'show' ? 'show' : 'movie',
      pageUrl,
      seriesUrl:      video.type === 'show' ? seriesUrl(video) : '',
      year:           video.year || null,
      runtimeMinutes: video.displayRuntime || video.runtime || null,
    };
  }

  function buildWatching(meta, videoEl, pageUrl) {
    const video = meta?.video;
    if (!video?.title || !videoEl) return null;

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
      base.thumbnailUrl    = pickThumbnail(video, episode) || base.thumbnailUrl;
      base.seasonNumber    = season?.seq ?? null;
      base.episodeNumber   = episode?.seq ?? null;
      base.episodeTitle    = episode?.title || '';
      base.episodeSynopsis = episode?.synopsis || '';
    } else {
      base.year           = video.year || null;
      base.runtimeMinutes = video.displayRuntime || video.runtime || null;
    }

    return base;
  }

  function run(name, args, document, location) {
    switch (name) {
      case 'netflix.browsingContext':
        return browsingContext(location.pathname);
      case 'netflix.buildPreview':
        return buildPreview(args.meta, args.pageUrl || location.href);
      case 'netflix.buildWatching': {
        const videoEl = document.querySelector(args.videoSelector || 'video');
        if (!videoEl || videoEl.readyState < (args.minReadyState ?? 2)) return null;
        return buildWatching(args.meta, videoEl, args.pageUrl || location.href);
      }
      case 'netflix.findEpisode':
        return findEpisode(args.video || args.meta?.video);
      case 'netflix.pickThumbnail':
        return pickThumbnail(args.video || args.meta?.video, args.episode);
      case 'netflix.seriesUrl':
        return seriesUrl(args.video || args.meta?.video);
      case 'reddit.absUrl': {
        const path = args.path || '';
        if (!path) return '';
        if (path.startsWith('https://')) return path;
        return `https://www.reddit.com${path.startsWith('/') ? path : `/${path}`}`;
      }
      case 'reddit.stripAuthor': {
        return String(args.value || '').replace(/^u\//, '');
      }
      case 'reddit.subredditFromPath': {
        const m = (location.pathname || '').match(/^\/r\/([^/]+)/);
        return m ? `r/${m[1]}` : '';
      }
      case 'reddit.userFromPath': {
        const m = (location.pathname || '').match(/^\/user\/([^/]+)/);
        return m ? `u/${m[1]}` : '';
      }
      case 'reddit.browsingContext': {
        const pathname = location.pathname || '';
        const sub = SyncrEngineHelpers.run('reddit.subredditFromPath', {}, document, location) ||
          document.querySelector('shreddit-subreddit-header')?.getAttribute('prefixed-name') ||
          (document.querySelector('.redditname')?.textContent?.trim()
            ? `r/${document.querySelector('.redditname').textContent.trim()}` : '');
        if (sub) return sub;
        const user = SyncrEngineHelpers.run('reddit.userFromPath', {}, document, location);
        if (user) return user;
        if (pathname.startsWith('/search')) {
          const q = new URLSearchParams(location.search).get('q');
          return q ? `Search: ${q}` : 'Search';
        }
        if (pathname.startsWith('/rpan')) return 'RPAN';
        return 'Home';
      }
      case 'reddit.sanitizeThumb': {
        let thumb = args.thumb || '';
        if (!thumb || thumb === 'self' || thumb === 'default' || thumb === 'nsfw') {
          thumb = args.og || '';
        }
        if (thumb && (thumb.includes('redditstatic.com/avatar') || thumb.includes('styles.redditmedia'))) {
          return '';
        }
        return thumb;
      }
      default:
        return null;
    }
  }

  return { run, findEpisode, pickThumbnail, seriesUrl, buildPreview, buildWatching, browsingContext };
})();
