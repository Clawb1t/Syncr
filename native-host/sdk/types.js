/**
 * Discord Rich Presence activity type constants.
 * @see https://discord.com/developers/docs/rich-presence/overview
 */
const ActivityType = {
  Playing:   0,
  Streaming: 1,
  Listening: 2,
  Watching:  3,
  Competing: 5,
};

/**
 * Which field Discord shows in the compact status line.
 */
const StatusDisplay = {
  Name:    0,
  State:   1,
  Details: 2,
};

/**
 * Activity flags bitmask.
 */
const Flags = {
  Instance: 1 << 0,
  Join:     1 << 1,
  Spectate: 1 << 2,
  PartyPrivacyFriends:    1 << 3,
  PartyPrivacyVoiceChannel: 1 << 4,
};

module.exports = { ActivityType, StatusDisplay, Flags };
