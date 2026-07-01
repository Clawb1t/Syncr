/**
 * Syncr Activity Template
 *
 * Copy this folder to native-host/activities/{your-id}/ and customize.
 * Folders prefixed with _ are skipped by the activity loader.
 *
 * The `syncr` argument is injected by the native host — do not require() it yourself.
 */

module.exports = {
  id:         'my-activity',
  name:       'My Activity',
  clientId:   'YOUR_DISCORD_APPLICATION_ID',
  urlPattern: '*://example.com/*',

  formatPresence(data, syncr) {
    // Idle / no active content
    if (data.browsing) {
      return syncr.browsing({
        type:    syncr.ActivityType.Playing,
        name:    'My Activity',
        logo:    'my_app_logo',   // Discord Developer Portal asset key
        details: 'Browsing...',
      });
    }

    return syncr.presence()
      .playing(data.title || 'Unknown')
      .details(data.subtitle)
      .state(data.paused ? 'Paused' : 'Playing')
      .largeImage(data.imageUrl || 'my_app_logo', data.title)
      .smallStatus(data.paused ? 'paused' : 'playing')
      .progressBar(data.currentTime, data.duration, { paused: data.paused })
      .button('Open', data.pageUrl)
      // .party(3, 5, 'session-id')           // optional party display
      // .secrets({ join: 'join-secret' })    // optional join button display
      // .metadata({ album, artist, title })  // optional for Listening type
      .build();
  },
};
