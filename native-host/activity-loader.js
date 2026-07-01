const fs   = require('fs');
const path = require('path');
const { ACTIVITIES_DIR } = require('./paths');

/** * Scans native-host/activities/ for activity folders.
 * Each folder must contain a presence.js exporting:
 *   { id, name, clientId, urlPattern, formatPresence }
 *
 * Folder structure:
 *   native-host/activities/
 *     youtube-music/
 *       presence.js
 */
function loadActivities() {
  const map = new Map();

  if (!fs.existsSync(ACTIVITIES_DIR)) return map;

  const entries = fs.readdirSync(ACTIVITIES_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;

    const presencePath = path.join(ACTIVITIES_DIR, entry.name, 'presence.js');

    if (!fs.existsSync(presencePath)) {
      process.stderr.write(`[ActivityLoader] Skipping ${entry.name} — no presence.js found\n`);
      continue;
    }

    try {
      delete require.cache[require.resolve(presencePath)];
      const mod = require(presencePath);

      const missing = ['id', 'name', 'clientId', 'urlPattern', 'formatPresence'].filter(k => !mod[k]);
      if (missing.length) {
        process.stderr.write(`[ActivityLoader] Skipping ${entry.name} — missing fields: ${missing.join(', ')}\n`);
        continue;
      }

      map.set(mod.id, mod);
      process.stderr.write(`[ActivityLoader] Loaded: ${mod.name} (${mod.id})\n`);
    } catch (err) {
      process.stderr.write(`[ActivityLoader] Error loading ${entry.name}/presence.js: ${err.message}\n`);
    }
  }

  return map;
}

module.exports = { loadActivities };
