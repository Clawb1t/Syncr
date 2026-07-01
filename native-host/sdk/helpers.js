const { ActivityType } = require('./types');
const { truncate, sanitizeUrl } = require('./validate');

/**
 * Wall-clock progress bar timestamps from playback position.
 * Omits timestamps when paused or duration is zero.
 */
function progressBar(currentSec, durationSec, { paused = false } = {}) {
  if (paused || !durationSec || durationSec <= 0) return undefined;

  const nowSec = Math.floor(Date.now() / 1000);
  const pos    = Math.floor(currentSec);
  const dur    = Math.floor(durationSec);

  return {
    start: nowSec - pos,
    end:   nowSec - pos + dur,
  };
}

/** Elapsed timer — start only (no end). */
function progressElapsed(startUnixSec) {
  if (startUnixSec == null) return undefined;
  return { start: Math.floor(startUnixSec) };
}

/** Countdown timer — end only (no start). */
function progressRemaining(endUnixSec) {
  if (endUnixSec == null) return undefined;
  return { end: Math.floor(endUnixSec) };
}

/**
 * Standard idle/browsing presence template.
 */
function browsing({ type = ActivityType.Playing, name, logo, details = 'Browsing...' }) {
  return {
    type,
    name:     truncate(name),
    details:  truncate(details),
    assets:   logo ? { large_image: logo, large_text: truncate(name) } : undefined,
    instance: false,
  };
}

module.exports = {
  progressBar,
  progressElapsed,
  progressRemaining,
  browsing,
  truncate,
  sanitizeUrl,
};
