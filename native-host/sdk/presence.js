const { ActivityType } = require('./types');
const { progressBar }  = require('./helpers');
const { validatePresence, truncate } = require('./validate');

class PresenceBuilder {
  constructor(type = ActivityType.Playing) {
    this._presence = { type, instance: false };
  }

  type(value) {
    this._presence.type = value;
    return this;
  }

  playing(name) {
    this._presence.type = ActivityType.Playing;
    if (name != null) this._presence.name = name;
    return this;
  }

  streaming(name) {
    this._presence.type = ActivityType.Streaming;
    if (name != null) this._presence.name = name;
    return this;
  }

  listening(name) {
    this._presence.type = ActivityType.Listening;
    if (name != null) this._presence.name = name;
    return this;
  }

  watching(name) {
    this._presence.type = ActivityType.Watching;
    if (name != null) this._presence.name = name;
    return this;
  }

  competing(name) {
    this._presence.type = ActivityType.Competing;
    if (name != null) this._presence.name = name;
    return this;
  }

  name(value) {
    if (value != null) this._presence.name = value;
    return this;
  }

  details(value) {
    if (value != null) this._presence.details = value;
    return this;
  }

  state(value) {
    if (value != null) this._presence.state = value;
    return this;
  }

  instance(value = true) {
    this._presence.instance = !!value;
    return this;
  }

  largeImage(image, text) {
    this._presence.assets = this._presence.assets || {};
    if (image != null) this._presence.assets.large_image = image;
    if (text  != null) this._presence.assets.large_text  = text;
    return this;
  }

  smallImage(image, text) {
    this._presence.assets = this._presence.assets || {};
    if (image != null) this._presence.assets.small_image = image;
    if (text  != null) this._presence.assets.small_text  = text;
    return this;
  }

  /** Convenience: small_image as playing/paused asset key with text. */
  smallStatus(statusKey, text) {
    return this.smallImage(statusKey, text);
  }

  timestamps(start, end) {
    const ts = {};
    if (start != null) ts.start = start;
    if (end   != null) ts.end   = end;
    if (Object.keys(ts).length) this._presence.timestamps = ts;
    return this;
  }

  progressBar(currentSec, durationSec, options = {}) {
    const ts = progressBar(currentSec, durationSec, options);
    if (ts) this._presence.timestamps = ts;
    return this;
  }

  button(label, url) {
    this._presence.buttons = this._presence.buttons || [];
    this._presence.buttons.push({ label, url });
    return this;
  }

  buttons(list) {
    if (Array.isArray(list)) {
      this._presence.buttons = list;
    }
    return this;
  }

  party(current, max, id) {
    const party = { size: [current, max] };
    if (id != null) party.id = id;
    this._presence.party = party;
    return this;
  }

  secrets({ join, spectate, match } = {}) {
    const s = {};
    if (join)     s.join     = join;
    if (spectate) s.spectate = spectate;
    if (match)    s.match    = match;
    if (Object.keys(s).length) this._presence.secrets = s;
    return this;
  }

  metadata({ album, artist, title, url, imageUrl } = {}) {
    const m = {};
    if (album)  m.album  = album;
    if (artist) m.artist = artist;
    if (title)  m.title  = title;
    if (url)    m.url    = url;
    if (imageUrl) m.imageUrl = imageUrl;
    if (Object.keys(m).length) this._presence.metadata = m;
    return this;
  }

  flags(value) {
    this._presence.flags = value;
    return this;
  }

  statusDisplay(value) {
    this._presence.status_display_type = value;
    return this;
  }

  supportedPlatforms(platforms) {
    if (Array.isArray(platforms)) this._presence.supported_platforms = platforms;
    return this;
  }

  build() {
    return validatePresence(this._presence);
  }
}

function presence(type) {
  return new PresenceBuilder(type);
}

module.exports = { PresenceBuilder, presence };
