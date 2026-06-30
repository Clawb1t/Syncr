/**
 * Syncr Activity: YouTube Music
 *
 * Uses Discord activity type 2 (Listening) so Discord shows
 * "Listening to YouTube Music" with a proper progress bar —
 * not the "Playing a game" format.
 */

module.exports = {
  id:         'youtube-music',
  name:       'YouTube Music',
  clientId:   '1521199365186785360',
  urlPattern: '*://music.youtube.com/*',

  formatPresence({ browsing, title, artist, album, albumArt, currentTime, duration, paused, pageUrl }) {
    // Browsing — not actively playing anything
    if (browsing) {
      return {
        type:     2,
        name:     'YouTube Music',
        details:  'Browsing...',
        assets:   { large_image: 'youtube_music_logo', large_text: 'YouTube Music' },
        instance: false,
      };
    }

    const songTitle  = title  || 'Unknown Title';
    const artistName = artist || 'Unknown Artist';

    // Third line: show album if different from title, otherwise service name.
    // When paused, prefix with "⏸ " so Discord users can see playback state
    // (timestamps are omitted when paused, so there's no other visual cue).
    const albumText = (album && album.toLowerCase() !== songTitle.toLowerCase())
      ? album
      : 'YouTube Music';
    const stateText = paused ? `⏸ Paused - ${albumText}` : albumText;

    const presence = {
      // type 2 = Listening.
      // `name` is the song title — Discord shows "Listening to [name]" in the
      // compact status bar, so users see the track name at a glance.
      type:    2,
      name:    songTitle,
      details: artistName,
      state:   stateText,

      assets: {
        large_image: albumArt || 'youtube_music_logo',
        large_text:  songTitle,
        small_image: paused ? 'paused' : 'playing',
        small_text:  paused ? 'Paused' : 'Playing',
      },

      instance: false,
    };

    // Progress bar: only set timestamps when actively playing.
    // Discord animates the scrubber using wall-clock time — it keeps ticking
    // even if playback stops. Omitting timestamps when paused matches Spotify's
    // Discord behaviour: the bar disappears and the song info stays visible.
    if (!paused && duration > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      presence.timestamps = {
        start: nowSec - Math.floor(currentTime),
        end:   nowSec - Math.floor(currentTime) + Math.floor(duration),
      };
    }

    if (pageUrl?.startsWith('https://')) {
      presence.buttons = [{ label: 'Listen on YouTube Music', url: pageUrl }];
    }

    return presence;
  },
};
