const { loadMissionControlRegistry } = require("./registry");
const { createMissionControlStore } = require("./store");

function initializeMissionControl(options = {}) {
  const logger = options.logger || console;

  try {
    const registry = loadMissionControlRegistry(options.config || {}, { now: options.now });
    const store = createMissionControlStore({
      dataDir: options.dataDir,
      registry,
      now: options.now,
    });
    const state = store.getState();

    logger.log(
      `[Mission Control] Initialized ${state.registry?.projectCount || 0} project(s), ${state.cards.length} card(s)`,
    );

    return {
      ready: true,
      store,
    };
  } catch (error) {
    logger.error(`[Mission Control] Failed to initialize: ${error.message}`);

    return {
      ready: false,
      error,
      store: null,
    };
  }
}

module.exports = {
  initializeMissionControl,
};
