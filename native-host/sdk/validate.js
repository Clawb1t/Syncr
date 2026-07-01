const LIMITS = {
  name:    128,
  details: 128,
  state:   128,
  large_text: 128,
  small_text: 128,
  button_label: 32,
  button_url:   512,
  party_id:     128,
  secret:       128,
};

function truncate(str, max = 128) {
  if (str == null || str === '') return undefined;
  const s = String(str);
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return undefined;
  const trimmed = url.trim();
  if (!/^https:\/\//i.test(trimmed)) return undefined;
  return trimmed.length > LIMITS.button_url
    ? trimmed.slice(0, LIMITS.button_url)
    : trimmed;
}

function sanitizeButtons(buttons) {
  if (!Array.isArray(buttons) || !buttons.length) return undefined;

  const out = [];
  for (const btn of buttons.slice(0, 2)) {
    if (!btn?.label || !btn?.url) continue;
    const url = sanitizeUrl(btn.url);
    if (!url) continue;
    out.push({
      label: truncate(btn.label, LIMITS.button_label),
      url,
    });
  }
  return out.length ? out : undefined;
}

function sanitizeParty(party) {
  if (!party) return undefined;
  const id = party.id != null ? truncate(String(party.id), LIMITS.party_id) : undefined;
  const size = Array.isArray(party.size) ? party.size : undefined;
  if (!id && !size) return undefined;
  const result = {};
  if (id) result.id = id;
  if (size && size.length >= 2) {
    result.size = [Math.max(0, Math.floor(size[0])), Math.max(0, Math.floor(size[1]))];
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeSecrets(secrets) {
  if (!secrets) return undefined;
  const out = {};
  for (const key of ['join', 'spectate', 'match']) {
    if (secrets[key]) out[key] = truncate(String(secrets[key]), LIMITS.secret);
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined;

  const out = {};
  for (const key of ['album', 'artist', 'title', 'url']) {
    if (metadata[key]) out[key] = truncate(String(metadata[key]));
  }
  if (metadata.imageUrl) {
    out.images = { large: { url: sanitizeUrl(metadata.imageUrl) || metadata.imageUrl } };
  } else if (metadata.images) {
    out.images = metadata.images;
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeAssets(assets) {
  if (!assets) return undefined;
  const out = {};
  if (assets.large_image) out.large_image = String(assets.large_image);
  if (assets.small_image) out.small_image = String(assets.small_image);
  if (assets.large_text)  out.large_text  = truncate(assets.large_text, LIMITS.large_text);
  if (assets.small_text)  out.small_text  = truncate(assets.small_text, LIMITS.small_text);
  return Object.keys(out).length ? out : undefined;
}

/**
 * Normalize and validate a presence object before sending to Discord IPC.
 */
function validatePresence(presence) {
  if (!presence || typeof presence !== 'object') {
    throw new Error('Presence must be a non-null object');
  }

  const activity = {
    type:     presence.type ?? 0,
    instance: !!presence.instance,
  };

  const name    = truncate(presence.name, LIMITS.name);
  const details = truncate(presence.details, LIMITS.details);
  const state   = truncate(presence.state, LIMITS.state);

  if (name)    activity.name    = name;
  if (details) activity.details = details;
  if (state)   activity.state   = state;

  if (presence.timestamps) {
    const ts = {};
    if (presence.timestamps.start != null) ts.start = Math.floor(presence.timestamps.start);
    if (presence.timestamps.end   != null) ts.end   = Math.floor(presence.timestamps.end);
    if (Object.keys(ts).length) activity.timestamps = ts;
  }

  const assets  = sanitizeAssets(presence.assets);
  const buttons = sanitizeButtons(presence.buttons);
  const party   = sanitizeParty(presence.party);
  const secrets = sanitizeSecrets(presence.secrets);
  const metadata = sanitizeMetadata(presence.metadata);

  if (assets)   activity.assets   = assets;
  if (buttons)  activity.buttons  = buttons;
  if (party)    activity.party    = party;
  if (secrets)  activity.secrets  = secrets;
  if (metadata) activity.metadata = metadata;

  if (presence.flags != null) activity.flags = presence.flags;
  if (presence.status_display_type != null) {
    activity.status_display_type = presence.status_display_type;
  }
  if (Array.isArray(presence.supported_platforms) && presence.supported_platforms.length) {
    activity.supported_platforms = presence.supported_platforms;
  }

  return activity;
}

/** Extract primary image URL for cache-bust detection. */
function primaryImageUrl(presence) {
  return presence?.assets?.large_image
    ?? presence?.metadata?.images?.large?.url
    ?? null;
}

module.exports = {
  LIMITS,
  truncate,
  sanitizeUrl,
  validatePresence,
  primaryImageUrl,
};
