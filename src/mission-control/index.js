const { createLinearSyncEngine } = require("./linear");
const { loadMissionControlRegistry, buildProjectRegistryIndexes } = require("./registry");
const { createSymphonyHealthProvider } = require("./health-provider");
const { createMissionControlStateStore } = require("./state-store");
const { deriveMissionCardSignals, deriveProjectSignals } = require("./signals");

function buildMissionControlPublicState({ linearState, registry, runtimeState, now = Date.now }) {
  const indexes = buildProjectRegistryIndexes(registry);
  const runtimeByProjectKey = new Map(
    (runtimeState.projects || []).map((project) => [project.projectKey, project]),
  );
  const cardsByProjectKey = new Map();
  const nowValue = typeof now === "function" ? now() : now;

  const masterCards = (linearState.masterCards || []).map((card) => {
    const registryProject = indexes.projectByLinearSlug.get(card.project?.slug) || null;
    const runtimeProject = registryProject
      ? runtimeByProjectKey.get(registryProject.key) || null
      : null;
    const healthStrip = deriveMissionCardSignals({
      card,
      project: registryProject,
      runtimeProject,
      now: nowValue,
    });

    if (registryProject) {
      const existing = cardsByProjectKey.get(registryProject.key) || [];
      existing.push({
        ...card,
        healthStrip,
        lane: registryProject.lane,
        projectKey: registryProject.key,
      });
      cardsByProjectKey.set(registryProject.key, existing);
    }

    return {
      ...card,
      lane: registryProject?.lane || null,
      projectKey: registryProject?.key || null,
      healthStrip,
    };
  });

  const projects = (registry.projects || []).map((project) => {
    const runtimeProject = runtimeByProjectKey.get(project.key) || null;
    const cards = cardsByProjectKey.get(project.key) || [];
    const healthStrip = deriveProjectSignals({ project, cards, runtimeProject });

    return {
      key: project.key,
      label: project.label,
      linearProjectSlug: project.linearProjectSlug,
      lane: project.lane,
      symphony: runtimeProject?.symphony || null,
      cardCount: cards.length,
      healthStrip,
    };
  });

  const laneMap = new Map();
  for (const project of projects) {
    const bucket = laneMap.get(project.lane) || {
      lane: project.lane,
      cardCount: 0,
      projectCount: 0,
      staleCardCount: 0,
      highRiskCardCount: 0,
      degradedProjectCount: 0,
    };
    bucket.projectCount += 1;
    bucket.cardCount += project.cardCount;
    bucket.staleCardCount += project.healthStrip.staleCardCount;
    bucket.highRiskCardCount += project.healthStrip.highRiskCardCount;
    bucket.degradedProjectCount += project.healthStrip.degraded ? 1 : 0;
    laneMap.set(project.lane, bucket);
  }

  const lanes = Array.from(laneMap.values())
    .map((lane) => ({
      ...lane,
      status:
        lane.degradedProjectCount > 0
          ? "degraded"
          : lane.highRiskCardCount > 0
            ? "risk"
            : lane.staleCardCount > 0
              ? "stale"
              : "ok",
    }))
    .sort((left, right) => left.lane.localeCompare(right.lane));

  return {
    updatedAt: new Date(nowValue).toISOString(),
    masterCards,
    projects,
    lanes,
    runtime: {
      provider: "symphony",
      updatedAt: runtimeState.updatedAt,
      projectCount: projects.length,
      degradedProjectCount: projects.filter((project) => project.healthStrip.degraded).length,
    },
    stats: {
      totalCards: masterCards.length,
      eventCount: Number(linearState.stats?.eventCount || 0),
      staleCards: masterCards.filter((card) => card.healthStrip?.stale).length,
      highRiskCards: masterCards.filter((card) => card.healthStrip?.risk === "high").length,
      projectCount: projects.length,
      laneCount: lanes.length,
    },
    sync: linearState.sync,
  };
}

function createMissionControlService({
  config,
  dataDir,
  logger = console,
  now = Date.now,
  onStateChange = () => {},
  fetchImpl = globalThis.fetch,
  setIntervalFn,
  clearIntervalFn,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  const registry = loadMissionControlRegistry(config || {});
  const stateStore = createMissionControlStateStore({ dataDir, now, logger });
  const linearSync = createLinearSyncEngine({
    config: config.integrations?.linear || {},
    dataDir,
    logger,
    now,
    setIntervalFn,
    clearIntervalFn,
    setTimeoutFn,
    clearTimeoutFn,
    onStateChange: (change) => {
      const publicState = refreshPublicState();
      onStateChange({ ...change, publicState });
    },
  });
  const healthProvider = createSymphonyHealthProvider({
    registry,
    dataDir,
    now,
    logger,
    fetchImpl,
    pollIntervalMs: config.missionControl?.symphonyPollIntervalMs || 30000,
    setIntervalFn,
    clearIntervalFn,
    onChange: (change) => {
      const publicState = refreshPublicState();
      onStateChange({ ...change, publicState });
    },
  });

  let publicState =
    stateStore.getState() ||
    buildMissionControlPublicState({
      linearState: linearSync.getPublicState(),
      registry,
      runtimeState: healthProvider.getState(),
      now,
    });

  function refreshPublicState() {
    publicState = buildMissionControlPublicState({
      linearState: linearSync.getPublicState(),
      registry,
      runtimeState: healthProvider.getState(),
      now,
    });
    stateStore.update(publicState);
    return publicState;
  }

  async function reconcile(options) {
    await linearSync.reconcile(options);
    return refreshPublicState();
  }

  async function refreshHealth() {
    await healthProvider.refresh();
    return refreshPublicState();
  }

  function start() {
    refreshPublicState();
    linearSync.start();
    healthProvider.start();
  }

  function stop() {
    linearSync.stop();
    healthProvider.stop();
  }

  return {
    getPublicState: () => publicState || refreshPublicState(),
    getWebhookPath: () => linearSync.getWebhookPath(),
    handleWebhook: (input) => linearSync.handleWebhook(input),
    isEnabled: () => linearSync.isEnabled(),
    reconcile,
    refreshHealth,
    start,
    stop,
  };
}

module.exports = {
  buildMissionControlPublicState,
  createMissionControlService,
};
