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

  formatPresence({ browsing, title, channelName, channelUrl, thumbnailUrl, currentTime, duration, paused, pageUrl }, syncr) {
    if (browsing) {
      return syncr.browsing({
        type:    syncr.ActivityType.Watching,
        name:    'YouTube',
        logo:    'youtube_logo',
        details: 'Browsing...',
      });
    }

    const videoTitle = title       || 'Unknown Video';
    const channel    = channelName || 'YouTube';

    const builder = syncr.presence()
      .watching(videoTitle)
      .details(channel)
      .state(paused ? '⏸ Paused' : 'Watching')
      .largeImage(thumbnailUrl || 'youtube_logo', videoTitle)
      .smallStatus(paused ? 'paused' : 'playing', paused ? 'Paused' : 'Watching')
      .progressBar(currentTime, duration, { paused });

    if (pageUrl?.startsWith('https://')) {
      builder.button('Watch Video', pageUrl);
    }
    if (channelUrl?.startsWith('https://')) {
      builder.button('View Channel', channelUrl);
    }

    return builder.build();
  },
};
