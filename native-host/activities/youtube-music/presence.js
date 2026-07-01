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

  formatPresence({ browsing, title, artist, album, albumArt, currentTime, duration, paused, pageUrl }, syncr) {
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
        url:      pageUrl?.startsWith('https://') ? pageUrl : undefined,
        imageUrl: albumArt?.startsWith('https://') ? albumArt : undefined,
      });

    if (pageUrl?.startsWith('https://')) {
      builder.button('Listen on YouTube Music', pageUrl);
    }

    return builder.build();
  },
};
