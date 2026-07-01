/**
 * Syncr Activity: Netflix
 *
 * Uses Discord activity type 3 (Watching) with browsing, search, title preview,
 * and playback with season/episode info and a progress bar.
 */

function truncate(text, max = 128) {
  if (!text) return '';
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatMovieState(year, runtimeMinutes) {
  const parts = [];
  if (year) parts.push(String(year));
  if (runtimeMinutes) parts.push(`${runtimeMinutes} min`);
  return parts.join(' · ') || 'Watching';
}

function formatEpisodeState(seasonNumber, episodeNumber, episodeTitle) {
  const parts = [];
  if (seasonNumber != null) parts.push(`S${seasonNumber}`);
  if (episodeNumber != null) parts.push(`E${episodeNumber}`);
  const prefix = parts.join(' · ');
  if (prefix && episodeTitle) return `${prefix}: ${episodeTitle}`;
  if (prefix) return prefix;
  return episodeTitle || 'Watching';
}

module.exports = {
  id:         'netflix',
  name:       'Netflix',
  clientId:   '1521836333528776704',
  urlPattern: '*://www.netflix.com/*',

  formatPresence(data, syncr) {
    const {
      browsing, browsingContext,
      mode, searchQuery,
      title, synopsis, thumbnailUrl, mediaType, pageUrl, seriesUrl,
      seasonNumber, episodeNumber, episodeTitle, episodeSynopsis,
      year, runtimeMinutes,
      currentTime, duration, paused,
    } = data;

    if (browsing) {
      const ctx = browsingContext && browsingContext !== 'Netflix'
        ? browsingContext
        : null;
      return syncr.browsing({
        type:    syncr.ActivityType.Watching,
        name:    'Netflix',
        logo:    'netflix_logo',
        details: ctx ? `Browsing ${ctx}` : 'Browsing Netflix',
      });
    }

    if (mode === 'search' && searchQuery) {
      return syncr.browsing({
        type:    syncr.ActivityType.Watching,
        name:    'Netflix',
        logo:    'netflix_logo',
        details: `Searching: ${searchQuery}`,
      });
    }

    if (mode === 'preview') {
      const showTitle = title || 'Netflix';
      const builder = syncr.presence()
        .watching(showTitle)
        .details(truncate(synopsis) || 'Browsing')
        .largeImage(thumbnailUrl || 'netflix_logo', showTitle)
        .smallStatus('reading', 'Browsing');

      if (pageUrl?.startsWith('https://')) {
        builder.button(mediaType === 'show' ? 'View Series' : 'View Movie', pageUrl);
      }

      return builder.build();
    }

    const showTitle = title || 'Unknown Title';

    if (mode === 'watching' && mediaType === 'show') {
      const builder = syncr.presence()
        .watching(showTitle)
        .details(formatEpisodeState(seasonNumber, episodeNumber, episodeTitle))
        .state(truncate(episodeSynopsis) || (paused ? 'Paused' : 'Watching'))
        .largeImage(thumbnailUrl || 'netflix_logo', showTitle)
        .smallStatus(paused ? 'paused' : 'playing', paused ? 'Paused' : 'Watching')
        .progressBar(currentTime, duration, { paused });

      if (pageUrl?.startsWith('https://')) {
        builder.button('Watch Episode', pageUrl);
      }
      if (seriesUrl?.startsWith('https://')) {
        builder.button('View Series', seriesUrl);
      }

      return builder.build();
    }

    const builder = syncr.presence()
      .watching(showTitle)
      .details(formatMovieState(year, runtimeMinutes))
      .state(paused ? 'Paused' : 'Watching')
      .largeImage(thumbnailUrl || 'netflix_logo', showTitle)
      .smallStatus(paused ? 'paused' : 'playing', paused ? 'Paused' : 'Watching')
      .progressBar(currentTime, duration, { paused });

    if (pageUrl?.startsWith('https://')) {
      builder.button('Watch Movie', pageUrl);
    }

    return builder.build();
  },
};
