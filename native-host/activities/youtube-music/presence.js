/**
 * Syncr Activity: YouTube Music
 *
 * Uses Discord activity type 2 (Listening) so Discord shows
 * "Listening to [track]" with a proper progress bar.
 */

module.exports = {
  id:         'youtube-music',
  name:       'YouTube Music',
  clientId:   '1521199365186785360',
  urlPattern: '*://music.youtube.com/*',

  formatPresence({ browsing, title, artist, album, albumArt, currentTime, duration, paused, pageUrl, videoId }, syncr) {
    if (browsing) {
      return syncr.browsing({
        type:    syncr.ActivityType.Listening,
        name:    'YouTube Music',
        logo:    'youtube_music_logo',
        details: 'Browsing...',
      });
    }

    const songTitle  = title  || 'Unknown Title';
    const artistName = artist || 'Unknown Artist';

    const albumText = (album && album.toLowerCase() !== songTitle.toLowerCase())
      ? album
      : 'YouTube Music';
    const stateText = paused ? `⏸ Paused - ${albumText}` : albumText;

    const listenUrl = resolveListenUrl({ pageUrl, videoId, title: songTitle, artist: artistName });

    const builder = syncr.presence()
      .listening(songTitle)
      .details(artistName)
      .state(stateText)
      .largeImage(albumArt || 'youtube_music_logo', songTitle)
      .smallStatus(paused ? 'paused' : 'playing', paused ? 'Paused' : 'Playing')
      .progressBar(currentTime, duration, { paused })
      .metadata({
        album:    album && album.toLowerCase() !== songTitle.toLowerCase() ? album : undefined,
        artist:   artistName,
        title:    songTitle,
        url:      listenUrl,
        imageUrl: albumArt?.startsWith('https://') ? albumArt : undefined,
      });

    builder.button('Listen on YouTube Music', listenUrl);

    return builder.build();
  },
};

function resolveListenUrl({ pageUrl, videoId, title, artist }) {
  const id = String(videoId ?? '').trim();
  if (id) return `https://music.youtube.com/watch?v=${id}`;

  const url = String(pageUrl ?? '').trim();
  if (url.includes('watch?v=') && !/\/watch\?v=$/.test(url)) return url;

  const q = [title, artist].filter(Boolean).join(' ').trim();
  if (q) return `https://music.youtube.com/search?q=${encodeURIComponent(q)}`;

  return url.startsWith('https://') ? url : 'https://music.youtube.com/';
}
