const {
  createMasterCardFromLinearIssue,
  getLabelNames,
  normalizeDispatch,
  normalizeLane,
  normalizeRisk,
  toIsoTimestamp,
} = require("./models");
const { buildProjectRegistryIndexes, loadMissionControlRegistry } = require("./registry");
const { createLinearSyncEngine } = require("./linear");
const { createSymphonyHealthProvider } = require("./health-provider");
const { deriveMissionCardSignals, deriveProjectSignals } = require("./signals");
const { cardMatchesSavedView, createMissionControlViewsStore } = require("./views");
const {
  createMissionControlNotificationService,
  deriveCardNotificationPolicy,
} = require("./notifications");

const RUNBOOKS = Object.freeze([
  {
    id: "sync-lag",
    title: "Sync lag runbook",
    path: "/docs/runbooks/mission-control-sync-lag.md",
  },
  {
    id: "webhook-outage",
    title: "Webhook outage runbook",
    path: "/docs/runbooks/mission-control-webhook-outage.md",
  },
  {
    id: "symphony-outage",
    title: "Symphony outage runbook",
    path: "/docs/runbooks/mission-control-symphony-outage.md",
  },
]);

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0m";
  }

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${Math.max(0, totalMinutes)}m`;
}

function getQueueThresholdMs(status) {
  switch (status) {
    case "in_progress":
      return 6 * 60 * 60 * 1000;
    case "blocked":
      return 8 * 60 * 60 * 1000;
    case "awaiting_review":
      return 12 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

function createFallbackProject(linearCard) {
  const labelNames = getLabelNames(linearCard.labels);
  const laneFromLabels = normalizeLane(
    labelNames.find((label) => label.startsWith("lane:")),
    null,
  );

  return {
    key: linearCard.project?.slug || linearCard.project?.id || "unmapped",
    label: linearCard.project?.name || linearCard.project?.slug || "Unmapped project",
    repoPath: "",
    linearProjectSlug: linearCard.project?.slug || "",
    lane: laneFromLabels,
    symphonyPort: null,
    symphony: null,
  };
}

function createDefaultRuntimeProject(project) {
  return {
    projectKey: project.key,
    linearProjectSlug: project.linearProjectSlug,
    lane: project.lane,
    symphony: project.symphony
      ? {
          endpoint: project.symphony.url,
          status: "unknown",
          reachable: false,
          responseCode: null,
          summary: "Probe pending",
          checkedAt: null,
          lastHealthyAt: null,
          lastError: null,
          queue: {
            active: 0,
            pending: 0,
            depth: 0,
          },
        }
      : null,
  };
}

function buildRuntimeIndexes(runtimeState = {}) {
  const runtimeProjects = Array.isArray(runtimeState.projects) ? runtimeState.projects : [];
  const runtimeByKey = new Map();
  const runtimeBySlug = new Map();

  for (const project of runtimeProjects) {
    if (project?.projectKey) {
      runtimeByKey.set(project.projectKey, project);
    }
    if (project?.linearProjectSlug) {
      runtimeBySlug.set(project.linearProjectSlug, project);
    }
  }

  return { runtimeByKey, runtimeBySlug };
}

function mapLinearCardToMissionCard(linearCard, { project, runtimeProject, now }) {
  const missionCard = createMasterCardFromLinearIssue(
    {
      issue: linearCard,
      project,
    },
    { now: linearCard.updatedAt || now() },
  );
  const healthStrip = deriveMissionCardSignals({
    card: linearCard,
    project,
    runtimeProject,
    now,
  });

  return {
    ...missionCard,
    identifier: linearCard.identifier || missionCard.primaryLinearIdentifier,
    url: linearCard.url || null,
    priority: linearCard.priority ?? null,
    estimate: linearCard.estimate ?? null,
    createdAt: linearCard.createdAt || missionCard.createdAt,
    updatedAt: linearCard.updatedAt || missionCard.updatedAt,
    startedAt: linearCard.startedAt || null,
    completedAt: linearCard.completedAt || missionCard.completedAt,
    canceledAt: linearCard.canceledAt || null,
    archivedAt: linearCard.archivedAt || missionCard.archivedAt,
    state: linearCard.state || null,
    project:
      linearCard.project ||
      (project
        ? {
            id: null,
            name: project.label || project.key,
            slug: project.linearProjectSlug || null,
            progress: null,
          }
        : null),
    team: linearCard.team || null,
    assignee: linearCard.assignee || null,
    labels: Array.isArray(linearCard.labels) ? linearCard.labels : [],
    cycle: linearCard.cycle || null,
    projectKey: project?.key || missionCard.originProjects[0] || null,
    latestUpdate:
      missionCard.latestUpdate ||
      (linearCard.updatedAt
        ? {
            summary: linearCard.state?.name
              ? `Linear updated · ${linearCard.state.name}`
              : "Linear updated",
            actor: linearCard.assignee?.name || null,
            source: "linear",
            capturedAt: linearCard.updatedAt,
          }
        : null),
    healthStrip,
  };
}

function buildLaneSummaries(projects, cards) {
  const laneMap = new Map();

  for (const card of cards) {
    if (!card.lane) {
      continue;
    }

    const entry = laneMap.get(card.lane) || {
      lane: card.lane,
      cardCount: 0,
      projectCount: 0,
      staleCardCount: 0,
      highRiskCardCount: 0,
      blockedCardCount: 0,
      degradedProjectCount: 0,
      status: "ok",
      risk: "low",
    };

    entry.cardCount += 1;
    if (card.healthStrip?.stale) {
      entry.staleCardCount += 1;
    }
    if (card.healthStrip?.blocked) {
      entry.blockedCardCount += 1;
    }
    if (card.healthStrip?.risk === "high") {
      entry.highRiskCardCount += 1;
    }

    laneMap.set(card.lane, entry);
  }

  for (const project of projects) {
    if (!project.lane) {
      continue;
    }

    const entry = laneMap.get(project.lane) || {
      lane: project.lane,
      cardCount: 0,
      projectCount: 0,
      staleCardCount: 0,
      highRiskCardCount: 0,
      blockedCardCount: 0,
      degradedProjectCount: 0,
      status: "ok",
      risk: "low",
    };

    entry.projectCount += 1;
    if (project.healthStrip?.degraded) {
      entry.degradedProjectCount += 1;
    }
    laneMap.set(project.lane, entry);
  }

  return Array.from(laneMap.values())
    .map((lane) => {
      let status = "ok";
      if (lane.degradedProjectCount > 0) {
        status = "degraded";
      } else if (lane.blockedCardCount > 0) {
        status = "blocked";
      } else if (lane.staleCardCount > 0) {
        status = "stale";
      }

      let risk = "low";
      if (lane.degradedProjectCount > 0 || lane.highRiskCardCount > 0) {
        risk = "high";
      } else if (lane.blockedCardCount > 0 || lane.staleCardCount > 0) {
        risk = "medium";
      }

      return {
        ...lane,
        status,
        risk,
      };
    })
    .sort((left, right) => left.lane.localeCompare(right.lane));
}

function buildMissionControlPublicState({
  linearState = {},
  registry = { projects: [], agents: [], discordDestinations: [] },
  runtimeState = { updatedAt: null, projects: [] },
  now = Date.now,
} = {}) {
  const linearCards = Array.isArray(linearState.masterCards) ? linearState.masterCards : [];
  const projectIndexes = buildProjectRegistryIndexes(registry);
  const { runtimeByKey, runtimeBySlug } = buildRuntimeIndexes(runtimeState);

  const masterCards = linearCards.map((linearCard) => {
    const project =
      projectIndexes.projectByLinearSlug.get(linearCard.project?.slug) ||
      createFallbackProject(linearCard);
    const runtimeProject =
      runtimeByKey.get(project.key) ||
      runtimeBySlug.get(project.linearProjectSlug) ||
      createDefaultRuntimeProject(project);

    const card = mapLinearCardToMissionCard(linearCard, {
      project,
      runtimeProject,
      now,
    });

    return {
      ...card,
      notificationPolicy: deriveCardNotificationPolicy({ card, registry }),
    };
  });

  const projectMap = new Map();
  for (const project of registry.projects || []) {
    projectMap.set(project.key, project);
  }
  for (const card of masterCards) {
    if (!card.projectKey || projectMap.has(card.projectKey)) {
      continue;
    }
    projectMap.set(
      card.projectKey,
      createFallbackProject({
        project: card.project,
        labels: card.labels,
      }),
    );
  }

  const projects = Array.from(projectMap.values())
    .map((project) => {
      const projectCards = masterCards.filter((card) => card.projectKey === project.key);
      const runtimeProject =
        runtimeByKey.get(project.key) ||
        runtimeBySlug.get(project.linearProjectSlug) ||
        createDefaultRuntimeProject(project);
      const healthStrip = deriveProjectSignals({
        project,
        cards: projectCards,
        runtimeProject,
      });

      return {
        key: project.key,
        label: project.label || project.key,
        repoPath: project.repoPath || "",
        linearProjectSlug: project.linearProjectSlug || null,
        lane: project.lane || null,
        cardCount: projectCards.length,
        symphony: runtimeProject?.symphony || null,
        healthStrip,
      };
    })
    .sort((left, right) => (left.label || left.key).localeCompare(right.label || right.key));

  const lanes = buildLaneSummaries(projects, masterCards);
  const updatedAtCandidates = [
    linearState.sync?.lastSuccessfulAt,
    runtimeState.updatedAt,
    masterCards[0]?.updatedAt,
  ].filter(Boolean);
  const updatedAt = updatedAtCandidates[0] || null;
  const degradedProjectCount = projects.filter((project) => project.healthStrip?.degraded).length;
  const staleCards = masterCards.filter((card) => card.healthStrip?.stale).length;
  const highRiskCards = masterCards.filter((card) => card.healthStrip?.risk === "high").length;

  return {
    updatedAt,
    masterCards,
    projects,
    lanes,
    runtime: {
      provider: "symphony",
      updatedAt: runtimeState.updatedAt || null,
      projectCount: projects.length,
      degradedProjectCount,
    },
    stats: {
      totalCards: masterCards.length,
      eventCount: Number(linearState.stats?.eventCount || 0),
      staleCards,
      highRiskCards,
      projectCount: projects.length,
      laneCount: lanes.length,
    },
    sync: linearState.sync || {
      status: "idle",
      mode: "hybrid",
      pollIntervalMs: 120000,
      projectSlugs: [],
      cursor: { updatedAfter: null },
      lastAttemptedAt: null,
      lastSuccessfulAt: null,
      lastWebhookAt: null,
      lastError: null,
      lastReason: null,
      lastFetchedCount: 0,
      lastChangedCount: 0,
      lagMs: null,
      webhook: {
        enabled: false,
        path: null,
        lastDeliveryId: null,
        recentDeliveryIds: [],
      },
    },
  };
}

function buildCardReplay(reference, timeline) {
  let latestCard = null;

  return timeline.map((event) => {
    if (event.type === "mission-control.linear.card-upserted" && event.payload?.card) {
      latestCard = event.payload.card;
    }

    return {
      sequence: event.sequence,
      occurredAt: event.occurredAt,
      type: event.type,
      source: event.source,
      identifier: event.identifier || reference.identifier || null,
      summary: summarizeEvent(event),
      snapshot: latestCard,
    };
  });
}

function summarizeEvent(event) {
  const action = event.payload?.action;

  switch (event.type) {
    case "mission-control.linear.reconcile.started":
      return `Reconcile started via ${event.source || "poll"}`;
    case "mission-control.linear.reconcile.completed":
      return `Reconcile completed (${event.payload?.changedCount || 0} changed)`;
    case "mission-control.linear.reconcile.failed":
      return `Reconcile failed: ${event.payload?.error || "unknown error"}`;
    case "mission-control.linear.webhook.received":
      return "Webhook accepted";
    case "mission-control.linear.webhook.duplicate":
      return "Duplicate webhook ignored";
    case "mission-control.linear.webhook.rejected":
      return `Webhook rejected: ${event.payload?.reason || "unknown"}`;
    case "mission-control.linear.card-observed":
      return `Issue observed (${event.source || "sync"}, no change)`;
    case "mission-control.linear.card-upserted":
      return `Card ${action || "updated"} via ${event.source || "sync"}`;
    default:
      return event.type;
  }
}

function buildCardDiagnostics({ card, sync, timeline, nowMs }) {
  const queueAnchor =
    Date.parse(card.source?.linearIssueUpdatedAt || card.updatedAt || card.createdAt || 0) || nowMs;
  const queueAgeMs = Math.max(0, nowMs - queueAnchor);
  const staleThresholdMs = getQueueThresholdMs(card.status);
  const stale = queueAgeMs >= staleThresholdMs;
  const lastWebhookEvent = [...timeline]
    .reverse()
    .find((event) => event.source === "webhook" || event.type.includes("webhook"));
  const lastPollEvent = [...timeline]
    .reverse()
    .find((event) => ["poller", "webhook-reconcile", "startup", "manual"].includes(event.source));

  let divergenceSource = null;
  const signals = [];
  let recommendedAction = null;

  const lastError = String(sync.lastError || "").toLowerCase();
  if (
    lastError.includes("persist") ||
    lastError.includes("append") ||
    lastError.includes("snapshot") ||
    sync.persistence?.enabled === false
  ) {
    divergenceSource = "state_write";
    signals.push("State write persistence is degraded.");
    recommendedAction = "Verify disk permissions/space and trigger a manual reconcile.";
  } else if (
    lastWebhookEvent &&
    (!lastPollEvent ||
      Date.parse(lastPollEvent.occurredAt) < Date.parse(lastWebhookEvent.occurredAt))
  ) {
    divergenceSource = "webhook";
    signals.push("Webhook activity has not been confirmed by a later reconcile.");
    recommendedAction = "Inspect Linear webhook delivery health, then trigger reconcile.";
  } else if (
    sync.status === "error" ||
    (Number.isFinite(sync.lagMs) &&
      Number.isFinite(sync.pollIntervalMs) &&
      sync.lagMs > sync.pollIntervalMs * 2)
  ) {
    divergenceSource = "poll";
    signals.push(
      sync.status === "error"
        ? `Poller error: ${sync.lastError}`
        : "Poller lag exceeds two sync intervals.",
    );
    recommendedAction = "Check Linear API reachability/credentials and trigger reconcile.";
  }

  if (stale) {
    signals.push(
      `Queue age ${formatDuration(queueAgeMs)} exceeds ${formatDuration(staleThresholdMs)}.`,
    );
  }

  return {
    queueAgeMs,
    queueAgeLabel: formatDuration(queueAgeMs),
    stale,
    staleThresholdMs,
    staleThresholdLabel: formatDuration(staleThresholdMs),
    divergenceSource,
    signals,
    recommendedAction,
  };
}

function buildDiagnostics(cards, syncStatus) {
  const bySource = { poll: 0, webhook: 0, state_write: 0 };
  let staleCards = 0;

  for (const card of cards) {
    if (card.diagnostics?.stale || card.healthStrip?.stale) {
      staleCards += 1;
    }
    if (card.diagnostics?.divergenceSource) {
      bySource[card.diagnostics.divergenceSource] += 1;
    }
  }

  return {
    syncStatus,
    staleCards,
    divergenceBySource: bySource,
    affectedCards: cards.filter(
      (card) =>
        card.healthStrip?.stale ||
        card.healthStrip?.status === "degraded" ||
        card.diagnostics?.divergenceSource,
    ),
  };
}

function createMissionControlService({
  config,
  dataDir,
  logger = console,
  now = Date.now,
  linearClient,
  discordFetchImpl,
  onStateChange,
  setIntervalFn,
  clearIntervalFn,
  setTimeoutFn,
  clearTimeoutFn,
} = {}) {
  let registryError = null;
  let registry;

  try {
    registry = loadMissionControlRegistry(config, { now: toIsoTimestamp(now()) });
  } catch (error) {
    registryError = error;
    logger.error("[Mission Control] Failed to load registry:", error.message);
    registry = {
      schemaVersion: 1,
      projectCount: 0,
      projects: [],
      agents: [],
      discordDestinations: [],
      createdAt: toIsoTimestamp(now()),
      updatedAt: toIsoTimestamp(now()),
      host: null,
    };
  }

  let linearSync;
  let symphonyHealth;
  let notificationService;

  function buildBoardState() {
    return buildMissionControlPublicState({
      linearState: linearSync.getPublicState(),
      registry,
      runtimeState: symphonyHealth.getState(),
      now,
    });
  }

  function buildCardsWithDiagnostics(boardState) {
    const nowMs = now();
    return boardState.masterCards.map((card) => {
      const timeline = linearSync.getTimelineForCard({
        cardId: card.id,
        issueId: card.primaryLinearIssueId,
        identifier: card.primaryLinearIdentifier,
      });

      return {
        ...card,
        diagnostics: buildCardDiagnostics({
          card,
          sync: boardState.sync,
          timeline,
          nowMs,
        }),
      };
    });
  }

  function getSavedViews() {
    return viewsStore.getState();
  }

  function getPublicState() {
    const boardState = buildBoardState();
    const masterCards = buildCardsWithDiagnostics(boardState);
    const savedViews = getSavedViews();
    const activeView = savedViews.views.find((view) => view.id === savedViews.activeViewId) || null;
    const activeCards = activeView
      ? masterCards.filter((card) => cardMatchesSavedView(card, activeView.filters, now()))
      : masterCards;
    const diagnostics = buildDiagnostics(masterCards, boardState.sync.status);

    return {
      ...boardState,
      ready: registryError === null,
      registryError: registryError ? registryError.message : null,
      registry: {
        projectCount: registry.projectCount,
        projects: registry.projects,
        agents: registry.agents,
        discordDestinations: registry.discordDestinations,
      },
      notifications: notificationService?.getPublicState() || {
        status: "ok",
        summary: "Discord notifications are healthy.",
        stats: { queued: 0, retrying: 0, delivered: 0, deadLetters: 0, totalConfigured: 0 },
        destinations: [],
        alertBanner: null,
        recentDeliveries: [],
      },
      stats: {
        ...boardState.stats,
        activeCards: activeCards.length,
        needsReview: masterCards.filter((card) => card.humanReviewRequired).length,
      },
      savedViews,
      activeView,
      masterCards,
      activeCards,
      diagnostics,
      runbooks: RUNBOOKS,
    };
  }

  function emitStateChange(change) {
    const publicState = getPublicState();
    notificationService?.handleMissionControlChange(change, publicState);

    if (typeof onStateChange === "function") {
      onStateChange({
        ...change,
        publicState: getPublicState(),
      });
    }
  }

  notificationService = createMissionControlNotificationService({
    registry,
    dataDir,
    now,
    logger,
    fetchImpl: discordFetchImpl,
    onChange: emitStateChange,
    setTimeoutFn,
    clearTimeoutFn,
  });

  linearSync = createLinearSyncEngine({
    config: config.integrations?.linear || {},
    dataDir,
    logger,
    now,
    client: linearClient,
    onStateChange: emitStateChange,
    setIntervalFn,
    clearIntervalFn,
    setTimeoutFn,
    clearTimeoutFn,
  });

  const viewsStore = createMissionControlViewsStore({ dataDir, now });
  symphonyHealth = createSymphonyHealthProvider({
    registry,
    dataDir,
    now,
    logger,
    pollIntervalMs: config.missionControl?.symphonyPollIntervalMs || 30000,
    setIntervalFn,
    clearIntervalFn,
    onChange: emitStateChange,
  });

  function findCardReference(cardRef) {
    const cards = getPublicState().masterCards;
    const match = cards.find(
      (card) =>
        card.id === cardRef ||
        card.primaryLinearIssueId === cardRef ||
        card.primaryLinearIdentifier === cardRef,
    );

    if (!match) {
      return null;
    }

    return {
      cardId: match.id,
      issueId: match.primaryLinearIssueId,
      identifier: match.primaryLinearIdentifier,
      card: match,
    };
  }

  function getCardTimeline(cardRef) {
    const reference = findCardReference(cardRef);
    if (!reference) {
      return null;
    }

    return linearSync.getTimelineForCard(reference);
  }

  function replayCardTimeline(cardRef) {
    const reference = findCardReference(cardRef);
    if (!reference) {
      return null;
    }

    const timeline = linearSync.getTimelineForCard(reference);
    return buildCardReplay(reference, timeline);
  }

  function getDiagnostics() {
    return getPublicState().diagnostics;
  }

  function resolveLaneOwner(card) {
    const explicitOwner = String(card?.responsibleAgents?.[0] || "")
      .trim()
      .toLowerCase();
    if (explicitOwner) {
      return explicitOwner;
    }

    switch (card?.lane) {
      case "lane:jon":
        return "jon";
      case "lane:mia":
        return "mia";
      case "lane:pepper":
        return "pepper";
      default:
        return "";
    }
  }

  async function createCrossLaneChildTask(cardRef, input = {}) {
    const reference = findCardReference(cardRef);
    if (!reference?.card) {
      const error = new Error("Mission Control card not found");
      error.code = "not_found";
      throw error;
    }

    if (!reference.card.primaryLinearIssueId) {
      const error = new Error("Mission Control card is missing a primary Linear issue");
      error.code = "invalid_parent";
      throw error;
    }

    const actor = String(input.actor || "")
      .trim()
      .toLowerCase();
    const parentOwner = resolveLaneOwner(reference.card);
    if (!actor) {
      const error = new Error("actor is required");
      error.code = "validation";
      throw error;
    }
    if (parentOwner && actor !== parentOwner) {
      const error = new Error(
        `Cross-lane child tasks must be created by the parent owner '${parentOwner}'`,
      );
      error.code = "forbidden";
      throw error;
    }

    const title = String(input.title || "").trim();
    if (!title) {
      const error = new Error("title is required");
      error.code = "validation";
      throw error;
    }

    if (typeof linearClient?.createIssue !== "function") {
      const error = new Error("Linear issue creation is not available");
      error.code = "unsupported";
      throw error;
    }

    const description = String(input.description || "").trim();
    const targetProjectKey = String(input.targetProjectKey || "").trim();
    const targetProjectSlug = String(input.targetProjectSlug || "").trim();
    const registryProject =
      registry.projects.find(
        (project) =>
          project.key === targetProjectKey || project.linearProjectSlug === targetProjectSlug,
      ) || null;
    const projectSlug = targetProjectSlug || registryProject?.linearProjectSlug || "";
    if (!projectSlug) {
      const error = new Error("targetProjectSlug or targetProjectKey is required");
      error.code = "validation";
      throw error;
    }

    const lane = normalizeLane(input.lane || registryProject?.lane, null);
    if (!lane) {
      const error = new Error("A valid target lane is required");
      error.code = "validation";
      throw error;
    }

    const risk = normalizeRisk(input.risk || "risk:low");
    const dispatch = normalizeDispatch(input.dispatch || "dispatch:ready", null);
    if (!dispatch) {
      const error = new Error("A valid dispatch state is required");
      error.code = "validation";
      throw error;
    }

    const projectContext =
      typeof linearClient.resolveProjectBySlug === "function"
        ? await linearClient.resolveProjectBySlug(projectSlug)
        : null;
    if (!projectContext?.id || !projectContext?.team?.id) {
      const error = new Error(`Unable to resolve Linear project context for '${projectSlug}'`);
      error.code = "invalid_target";
      throw error;
    }

    const labelNames = [lane, risk, dispatch];
    const labelIds =
      typeof linearClient.resolveLabelIdsForTeam === "function"
        ? await linearClient.resolveLabelIdsForTeam({
            teamId: projectContext.team.id,
            labelNames,
          })
        : [];

    const createdIssue = await linearClient.createIssue({
      title,
      description,
      parentId: reference.card.primaryLinearIssueId,
      teamId: projectContext.team.id,
      projectId: projectContext.id,
      labelIds,
    });

    if (typeof linearSync.hydrateIssuesByIds === "function") {
      await linearSync.hydrateIssuesByIds([reference.card.primaryLinearIssueId, createdIssue.id], {
        source: "manual-cross-lane-child",
      });
    } else {
      await linearSync.reconcile({ reason: "manual" });
    }

    const publicState = getPublicState();
    const parentCard =
      publicState.masterCards.find((card) => card.id === reference.card.id) || null;
    const childCard =
      publicState.masterCards.find((card) => card.primaryLinearIssueId === createdIssue.id) || null;

    return {
      createdIssue,
      parentCard,
      childCard,
      board: publicState,
    };
  }

  return {
    start: () => {
      linearSync.bootstrap();
      symphonyHealth.start();
      return linearSync.start();
    },
    stop: () => {
      symphonyHealth.stop();
      return linearSync.stop();
    },
    reconcile: async (options) => {
      const result = await linearSync.reconcile(options);
      return result;
    },
    handleWebhook: (input) => linearSync.handleWebhook(input),
    getWebhookPath: () => linearSync.getWebhookPath(),
    getSavedViews,
    getDiagnostics,
    getPublicState,
    getCardTimeline,
    replayCardTimeline,
    setActiveView: (viewId) => viewsStore.setActiveView(viewId),
    createCrossLaneChildTask,
  };
}

module.exports = {
  RUNBOOKS,
  buildMissionControlPublicState,
  createMissionControlService,
};
