/**
 * Syncr Activity: YouTube
 *
 * Uses Discord activity type 3 (Watching) with two buttons:
 * one to the video and one to the channel.
 */

module.exports = {
  id:         'youtube',
  name:       'YouTube',
  clientId:   '1521557457699078214',
  urlPattern: '*://www.youtube.com/watch*',

  formatPresence({ browsing, title, channelName, channelUrl, thumbnailUrl, currentTime, duration, paused, pageUrl }) {
    // Browsing — not watching a video
    if (browsing) {
      return {
        type:     3,
        name:     'YouTube',
        details:  'Browsing...',
        assets:   { large_image: 'youtube_logo', large_text: 'YouTube' },
        instance: false,
      };
    }

    const videoTitle = title       || 'Unknown Video';
    const channel    = channelName || 'YouTube';

    const presence = {
      // type 3 = Watching — shows "Watching YouTube" in Discord
      type:    3,
      name:    videoTitle,   // compact status: "Watching [video title]"
      details: channel,      // first line: channel name
      state:   paused ? '⏸ Paused' : 'Watching',

      assets: {
        large_image: thumbnailUrl || 'youtube_logo',
        large_text:  videoTitle,
        small_image: paused ? 'paused' : 'playing',
        small_text:  paused ? 'Paused' : 'Watching',
      },

      instance: false,
    };

    // Progress bar — omit when paused so Discord bar doesn't keep ticking
    if (!paused && duration > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      presence.timestamps = {
        start: nowSec - Math.floor(currentTime),
        end:   nowSec - Math.floor(currentTime) + Math.floor(duration),
      };
    }

    // Two buttons: video + channel
    const buttons = [];
    if (pageUrl?.startsWith('https://')) {
      buttons.push({ label: 'Watch Video', url: pageUrl });
    }
    if (channelUrl?.startsWith('https://')) {
      buttons.push({ label: 'View Channel', url: channelUrl });
    }
    if (buttons.length) presence.buttons = buttons.slice(0, 2);

    return presence;
  },
};
