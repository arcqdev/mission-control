const {
  createMasterCardFromLinearIssue,
  getLabelNames,
  normalizeLane,
  toIsoTimestamp,
} = require("./models");
const { buildProjectRegistryIndexes, loadMissionControlRegistry } = require("./registry");
const { createLinearSyncEngine } = require("./linear");
const { cardMatchesSavedView, createMissionControlViewsStore } = require("./views");

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
  const laneFromLabels = normalizeLane(labelNames.find((label) => label.startsWith("lane:")), null);

  return {
    key: linearCard.project?.slug || linearCard.project?.id || "unmapped",
    repoPath: "",
    linearProjectSlug: linearCard.project?.slug || "",
    lane: laneFromLabels,
    symphonyPort: null,
  };
}

function decorateMasterCard({ baseCard, linearCard, diagnostics, runtimeProject = null }) {
  const signals = [];
  const operationalRisk =
    runtimeProject?.symphony?.status === "unreachable" || diagnostics.stale || baseCard.risk === "risk:high"
      ? "high"
      : "low";

  if (runtimeProject?.symphony?.status === "unreachable") {
    signals.push("symphony-down");
  }
  if (diagnostics.stale) {
    signals.push("stale-work");
  }
  if (baseCard.risk === "risk:high") {
    signals.push("high-risk");
  }

  return {
    ...baseCard,
    identifier: baseCard.primaryLinearIdentifier,
    description: linearCard.description || "",
    url: linearCard.url || null,
    priority: linearCard.priority ?? null,
    estimate: linearCard.estimate ?? null,
    state: linearCard.state || null,
    project: linearCard.project || null,
    team: linearCard.team || null,
    assignee: linearCard.assignee || null,
    labels: linearCard.labels || [],
    cycle: linearCard.cycle || null,
    healthStrip: {
      stale: diagnostics.stale,
      risk: operationalRisk,
      status:
        runtimeProject?.symphony?.status === "unreachable" || diagnostics.stale ? "degraded" : "healthy",
      signals,
    },
    diagnostics,
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
    (!lastPollEvent || Date.parse(lastPollEvent.occurredAt) < Date.parse(lastWebhookEvent.occurredAt))
  ) {
    divergenceSource = "webhook";
    signals.push("Webhook activity has not been confirmed by a later reconcile.");
    recommendedAction = "Inspect Linear webhook delivery health, then trigger reconcile.";
  } else if (
    sync.status === "error" ||
    (Number.isFinite(sync.lagMs) && Number.isFinite(sync.pollIntervalMs) && sync.lagMs > sync.pollIntervalMs * 2)
  ) {
    divergenceSource = "poll";
    signals.push(sync.status === "error" ? `Poller error: ${sync.lastError}` : "Poller lag exceeds two sync intervals.");
    recommendedAction = "Check Linear API reachability/credentials and trigger reconcile.";
  }

  if (stale) {
    signals.push(`Queue age ${formatDuration(queueAgeMs)} exceeds ${formatDuration(staleThresholdMs)}.`);
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

function createMissionControlService({
  config,
  dataDir,
  logger = console,
  now = Date.now,
  linearClient,
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

  const projectIndexes = buildProjectRegistryIndexes(registry);
  const linearSync = createLinearSyncEngine({
    config: config.integrations?.linear || {},
    dataDir,
    registry,
    logger,
    now,
    client: linearClient,
    onStateChange,
    setIntervalFn,
    clearIntervalFn,
    setTimeoutFn,
    clearTimeoutFn,
  });
  const viewsStore = createMissionControlViewsStore({ dataDir, now });

  function buildMasterCards() {
    const linearState = linearSync.getPublicState();
    const nowMs = now();

    return linearState.masterCards.map((linearCard) => {
      const project =
        projectIndexes.projectByLinearSlug.get(linearCard.project?.slug) || createFallbackProject(linearCard);
      const baseCard = createMasterCardFromLinearIssue(
        {
          issue: linearCard,
          project,
        },
        { now: linearCard.updatedAt || nowMs },
      );
      const timeline = linearSync.getTimelineForCard({
        cardId: baseCard.id,
        issueId: baseCard.primaryLinearIssueId,
        identifier: baseCard.primaryLinearIdentifier,
      });
      const diagnostics = buildCardDiagnostics({
        card: baseCard,
        sync: linearState.sync,
        timeline,
        nowMs,
      });

      return decorateMasterCard({
        baseCard,
        linearCard,
        diagnostics,
      });
    });
  }

  function findCardReference(cardRef) {
    const cards = buildMasterCards();
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
    const linearState = linearSync.getPublicState();
    const cards = buildMasterCards();
    const bySource = { poll: 0, webhook: 0, state_write: 0 };
    let staleCards = 0;

    for (const card of cards) {
      if (card.diagnostics.stale) {
        staleCards += 1;
      }
      if (card.diagnostics.divergenceSource) {
        bySource[card.diagnostics.divergenceSource] += 1;
      }
    }

    return {
      syncStatus: linearState.sync.status,
      staleCards,
      divergenceBySource: bySource,
      affectedCards: cards.filter(
        (card) => card.diagnostics.stale || card.diagnostics.divergenceSource,
      ),
    };
  }

  function getSavedViews() {
    return viewsStore.getState();
  }

  function getPublicState() {
    const linearState = linearSync.getPublicState();
    const masterCards = buildMasterCards();
    const diagnostics = getDiagnostics();
    const savedViews = getSavedViews();
    const activeView = savedViews.views.find((view) => view.id === savedViews.activeViewId) || null;
    const activeCards = activeView
      ? masterCards.filter((card) => cardMatchesSavedView(card, activeView.filters, now()))
      : masterCards;

    return {
      ready: registryError === null,
      registryError: registryError ? registryError.message : null,
      registry: {
        projectCount: registry.projectCount,
        projects: registry.projects,
        agents: registry.agents,
      },
      sync: linearState.sync,
      stats: {
        totalCards: masterCards.length,
        activeCards: activeCards.length,
        eventCount: linearState.stats.eventCount,
        staleCards: diagnostics.staleCards,
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

  return {
    start: () => {
      linearSync.bootstrap();
      linearSync.start();
    },
    stop: () => linearSync.stop(),
    reconcile: (options) => linearSync.reconcile(options),
    handleWebhook: (input) => linearSync.handleWebhook(input),
    getWebhookPath: () => linearSync.getWebhookPath(),
    getSavedViews,
    getDiagnostics,
    getPublicState,
    getCardTimeline,
    replayCardTimeline,
    setActiveView: (viewId) => viewsStore.setActiveView(viewId),
  };
}

function buildMissionControlPublicState({
  linearState,
  registry,
  runtimeState = { projects: [], updatedAt: null },
  now = Date.now,
}) {
  const projectIndexes = buildProjectRegistryIndexes(registry);
  const nowMs = typeof now === "function" ? now() : now;
  const runtimeProjects = Array.isArray(runtimeState.projects) ? runtimeState.projects : [];

  const masterCards = (linearState.masterCards || []).map((linearCard) => {
    const project =
      projectIndexes.projectByLinearSlug.get(linearCard.project?.slug) || createFallbackProject(linearCard);
    const baseCard = createMasterCardFromLinearIssue(
      {
        issue: linearCard,
        project,
      },
      { now: linearCard.updatedAt || nowMs },
    );
    const runtimeProject = runtimeProjects.find(
      (entry) =>
        entry.projectKey === project.key || entry.linearProjectSlug === project.linearProjectSlug,
    );
    const diagnostics = buildCardDiagnostics({
      card: baseCard,
      sync: linearState.sync || {},
      timeline: [],
      nowMs,
    });

    return decorateMasterCard({
      baseCard,
      linearCard,
      diagnostics,
      runtimeProject,
    });
  });

  const projects = (registry.projects || []).map((project) => {
    const projectCards = masterCards.filter(
      (card) =>
        card.originProjects.includes(project.key) || card.project?.slug === project.linearProjectSlug,
    );
    const runtimeProject = runtimeProjects.find(
      (entry) =>
        entry.projectKey === project.key || entry.linearProjectSlug === project.linearProjectSlug,
    );
    const degraded =
      runtimeProject?.symphony?.status === "unreachable" || projectCards.some((card) => card.healthStrip.stale);
    const signals = [];
    if (runtimeProject?.symphony?.status === "unreachable") {
      signals.push("symphony-down");
    }
    if (projectCards.some((card) => card.healthStrip.stale)) {
      signals.push("stale-work");
    }

    return {
      projectKey: project.key,
      linearProjectSlug: project.linearProjectSlug,
      lane: project.lane,
      symphony: runtimeProject?.symphony || {
        endpoint: project.symphony?.endpoint || project.symphony?.url || null,
        status: project.symphony ? "unknown" : "unconfigured",
        reachable: false,
        summary: project.symphony ? "Probe pending" : "Symphony runtime not configured",
        queue: { active: 0, pending: 0, depth: 0 },
      },
      healthStrip: {
        status: degraded ? "degraded" : "healthy",
        highRiskCardCount: projectCards.filter((card) => card.healthStrip.risk === "high").length,
        staleCardCount: projectCards.filter((card) => card.healthStrip.stale).length,
        signals,
      },
    };
  });

  const lanes = [...new Set((registry.projects || []).map((project) => project.lane).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((lane) => {
      const laneCards = masterCards.filter((card) => card.lane === lane);
      return {
        lane,
        cardCount: laneCards.length,
        highRiskCardCount: laneCards.filter((card) => card.healthStrip.risk === "high").length,
        staleCardCount: laneCards.filter((card) => card.healthStrip.stale).length,
      };
    });

  return {
    updatedAt: runtimeState.updatedAt || linearState.sync?.lastSuccessfulAt || null,
    registry,
    sync: linearState.sync,
    stats: {
      totalCards: masterCards.length,
      eventCount: Number(linearState.stats?.eventCount || 0),
    },
    masterCards,
    projects,
    lanes,
  };
}

module.exports = {
  RUNBOOKS,
  buildMissionControlPublicState,
  createMissionControlService,
};
