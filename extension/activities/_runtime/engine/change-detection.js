'use strict';

const SyncrEngineChangeDetection = (function () {
  function createState() {
    return { lastSent: null, sentAt: 0, sentPos: 0 };
  }

  function shouldSend(data, state, config) {
    if (!config) return true;
    if (!state.lastSent) return true;

    const last = state.lastSent;
    const cfg = config;

    if (cfg.alwaysSendOn) {
      for (const key of cfg.alwaysSendOn) {
        if (data[key] !== last[key]) return true;
      }
    }

    if (data.browsing && last.browsing) {
      if (data.browsingContext !== last.browsingContext) return true;
      return false;
    }

    if (data.browsing !== last.browsing) return true;
    if (data.mode !== last.mode) return true;

    const fields = cfg.compareFields || [];
    for (const f of fields) {
      if (data[f] !== last[f]) return true;
    }

    const pb = cfg.playbackFields;
    if (pb && data[pb.time] != null && last[pb.time] != null) {
      const pauseChg = data[pb.paused] !== last[pb.paused];
      if (pauseChg) return true;

      const seekThreshold = cfg.seekThreshold ?? 5;
      if (!last[pb.paused] && !data[pb.paused]) {
        const expected = state.sentPos + (Date.now() - state.sentAt) / 1000;
        if (Math.abs(data[pb.time] - expected) > seekThreshold) return true;
      }
    }

    return false;
  }

  function trackSent(data, state, config) {
    state.lastSent = { ...data };
    const pb = config?.playbackFields;
    if (pb && data[pb.time] != null && data.mode === 'watching') {
      state.sentAt  = Date.now();
      state.sentPos = data[pb.time];
    } else if (data.currentTime != null && !data.browsing) {
      state.sentAt  = Date.now();
      state.sentPos = data.currentTime;
    } else {
      state.sentAt  = 0;
      state.sentPos = 0;
    }
  }

  function reset(state) {
    state.lastSent = null;
    state.sentAt   = 0;
    state.sentPos  = 0;
  }

  return { createState, shouldSend, trackSent, reset };
})();
