function isoNow(now = Date.now) {
  return new Date(now()).toISOString();
}

function uniqueCount(values) {
  return new Set(values.filter(Boolean)).size;
}

function countBy(items, getKey) {
  const counts = new Map();

  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

function normalizeMissionControlState(publicState = {}) {
  const masterCards = Array.isArray(publicState.masterCards) ? publicState.masterCards : [];
  const stats = {
    totalCards: Number(publicState.stats?.totalCards || masterCards.length),
    eventCount: Number(publicState.stats?.eventCount || 0),
  };
  const sync = {
    status: publicState.sync?.status || "idle",
    mode: publicState.sync?.mode || "hybrid",
    pollIntervalMs: Number(publicState.sync?.pollIntervalMs || 120000),
    projectSlugs: Array.isArray(publicState.sync?.projectSlugs)
      ? publicState.sync.projectSlugs
      : [],
    cursor: publicState.sync?.cursor || { updatedAfter: null },
    lastAttemptedAt: publicState.sync?.lastAttemptedAt || null,
    lastSuccessfulAt: publicState.sync?.lastSuccessfulAt || null,
    lastWebhookAt: publicState.sync?.lastWebhookAt || null,
    lastError: publicState.sync?.lastError || null,
    lastReason: publicState.sync?.lastReason || null,
    lastFetchedCount: Number(publicState.sync?.lastFetchedCount || 0),
    lastChangedCount: Number(publicState.sync?.lastChangedCount || 0),
    lagMs:
      publicState.sync?.lagMs === null || publicState.sync?.lagMs === undefined
        ? null
        : Number(publicState.sync.lagMs),
    webhook: {
      enabled: Boolean(publicState.sync?.webhook?.enabled),
      path: publicState.sync?.webhook?.path || null,
      lastDeliveryId: publicState.sync?.webhook?.lastDeliveryId || null,
      recentDeliveryIds: Array.isArray(publicState.sync?.webhook?.recentDeliveryIds)
        ? publicState.sync.webhook.recentDeliveryIds
        : [],
    },
  };

  return {
    updatedAt: publicState.updatedAt || sync.lastSuccessfulAt || null,
    masterCards,
    stats,
    sync,
  };
}

function getLagSummary(sync) {
  const staleThresholdMs = Math.max(sync.pollIntervalMs * 2, 60000);
  const lagMs = sync.lagMs;
  const isStale = lagMs !== null && lagMs > staleThresholdMs;

  return {
    milliseconds: lagMs,
    seconds: lagMs === null ? null : Math.round(lagMs / 1000),
    staleThresholdMs,
    isStale,
  };
}

function buildBoardPayload(publicState, now = Date.now) {
  const state = normalizeMissionControlState(publicState);
  const cards = state.masterCards;

  return {
    version: 1,
    generatedAt: isoNow(now),
    updatedAt: state.updatedAt,
    masterCards: cards,
    stats: {
      ...state.stats,
      projectCount: uniqueCount(cards.map((card) => card.project?.slug || card.project?.name)),
      teamCount: uniqueCount(cards.map((card) => card.team?.key || card.team?.name)),
      stateCount: uniqueCount(cards.map((card) => card.state?.name)),
      assigneeCount: uniqueCount(cards.map((card) => card.assignee?.email || card.assignee?.name)),
    },
    sync: buildSyncPayload(state, now).sync,
  };
}

function buildFiltersPayload(publicState, now = Date.now) {
  const state = normalizeMissionControlState(publicState);
  const cards = state.masterCards;

  const projectCounts = countBy(cards, (card) => card.project?.slug || card.project?.name);
  const teamCounts = countBy(cards, (card) => card.team?.key || card.team?.name);
  const stateCounts = countBy(cards, (card) => card.state?.name);
  const assigneeCounts = countBy(cards, (card) => card.assignee?.email || card.assignee?.name);
  const labelCounts = new Map();
  const priorityCounts = countBy(cards, (card) => String(card.priority ?? "unassigned"));
  const estimateCounts = countBy(cards, (card) => String(card.estimate ?? "unestimated"));
  const cycleCounts = countBy(cards, (card) => card.cycle?.id || card.cycle?.name);

  for (const card of cards) {
    for (const label of card.labels || []) {
      const key = label.id || label.name;
      if (!key) continue;
      labelCounts.set(key, {
        key,
        label: label.name || key,
        color: label.color || null,
        count: (labelCounts.get(key)?.count || 0) + 1,
      });
    }
  }

  return {
    version: 1,
    generatedAt: isoNow(now),
    updatedAt: state.updatedAt,
    totalCards: state.stats.totalCards,
    filters: {
      projects: Array.from(projectCounts.entries())
        .map(([key, count]) => {
          const card = cards.find((entry) => (entry.project?.slug || entry.project?.name) === key);
          return {
            key,
            label: card?.project?.name || key,
            slug: card?.project?.slug || null,
            count,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
      teams: Array.from(teamCounts.entries())
        .map(([key, count]) => {
          const card = cards.find((entry) => (entry.team?.key || entry.team?.name) === key);
          return {
            key,
            label: card?.team?.name || key,
            teamKey: card?.team?.key || null,
            count,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
      states: Array.from(stateCounts.entries())
        .map(([key, count]) => {
          const card = cards.find((entry) => entry.state?.name === key);
          return {
            key,
            label: key,
            type: card?.state?.type || null,
            color: card?.state?.color || null,
            count,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
      assignees: Array.from(assigneeCounts.entries())
        .map(([key, count]) => {
          const card = cards.find(
            (entry) => (entry.assignee?.email || entry.assignee?.name) === key,
          );
          return {
            key,
            label: card?.assignee?.name || key,
            email: card?.assignee?.email || null,
            count,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
      labels: Array.from(labelCounts.values()).sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
      priorities: Array.from(priorityCounts.entries())
        .map(([value, count]) => ({
          value: value === "unassigned" ? null : Number(value),
          label: value === "unassigned" ? "Unassigned" : `Priority ${value}`,
          count,
        }))
        .sort((left, right) => {
          if (left.value === null) return 1;
          if (right.value === null) return -1;
          return left.value - right.value;
        }),
      estimates: Array.from(estimateCounts.entries())
        .map(([value, count]) => ({
          value: value === "unestimated" ? null : Number(value),
          label: value === "unestimated" ? "Unestimated" : `${value} points`,
          count,
        }))
        .sort((left, right) => {
          if (left.value === null) return 1;
          if (right.value === null) return -1;
          return left.value - right.value;
        }),
      cycles: Array.from(cycleCounts.entries())
        .map(([key, count]) => {
          const card = cards.find((entry) => (entry.cycle?.id || entry.cycle?.name) === key);
          return {
            key,
            label: card?.cycle?.name || key,
            number: card?.cycle?.number || null,
            count,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label)),
    },
  };
}

function buildHealthPayload(publicState, now = Date.now) {
  const state = normalizeMissionControlState(publicState);
  const sync = state.sync;
  const lag = getLagSummary(sync);
  const cards = state.masterCards;
  const countsByStateType = cards.reduce((result, card) => {
    const key = card.state?.type || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});

  let status = "ok";
  let summary = "Mission Control is healthy.";

  if (sync.status === "disabled") {
    status = "disabled";
    summary = sync.lastError || "Mission Control sync is disabled.";
  } else if (sync.status === "error") {
    status = "error";
    summary = sync.lastError || "Mission Control sync is reporting an error.";
  } else if (lag.isStale) {
    status = "stale";
    summary = "Mission Control data is older than the configured stale threshold.";
  } else if (sync.status === "syncing" || !sync.lastSuccessfulAt) {
    status = "degraded";
    summary = "Mission Control is still warming up or reconciling.";
  }

  return {
    version: 1,
    generatedAt: isoNow(now),
    updatedAt: state.updatedAt,
    health: {
      status,
      summary,
      counts: {
        totalCards: state.stats.totalCards,
        unassignedCards: cards.filter((card) => !card.assignee?.name && !card.assignee?.email)
          .length,
        byStateType: countsByStateType,
      },
      sync: {
        status: sync.status,
        lagMs: sync.lagMs,
        staleThresholdMs: lag.staleThresholdMs,
        lastSuccessfulAt: sync.lastSuccessfulAt,
        lastAttemptedAt: sync.lastAttemptedAt,
        lastError: sync.lastError,
      },
    },
  };
}

function buildSyncPayload(publicState, now = Date.now) {
  const state = normalizeMissionControlState(publicState);
  const lag = getLagSummary(state.sync);

  return {
    version: 1,
    generatedAt: isoNow(now),
    updatedAt: state.updatedAt,
    enabled: state.sync.status !== "disabled",
    sync: {
      ...state.sync,
      lag,
    },
    stats: state.stats,
  };
}

function buildAdminStatusPayload(publicState, meta = {}, now = Date.now) {
  const state = normalizeMissionControlState(publicState);

  return {
    version: 1,
    generatedAt: isoNow(now),
    updatedAt: state.updatedAt,
    enabled: state.sync.status !== "disabled",
    sse: {
      clientCount: Number(meta.sseClientCount || 0),
      lastReplayAt: meta.lastReplayAt || null,
      lastMissionControlEventAt: meta.lastMissionControlEventAt || null,
    },
    stats: state.stats,
    sync: buildSyncPayload(state, now).sync,
    health: buildHealthPayload(state, now).health,
  };
}

function buildMissionControlEventPayload(change, publicState, now = Date.now) {
  const state = normalizeMissionControlState(publicState);
  const payload = {
    version: 1,
    emittedAt: isoNow(now),
    type: change?.type || "state",
    stats: state.stats,
    sync: buildSyncPayload(state, now).sync,
  };

  if (change?.type === "card-upserted") {
    payload.delta = {
      action: change.action || "updated",
      cardId: change.card?.id || null,
      identifier: change.card?.identifier || null,
      updatedAt: change.card?.updatedAt || null,
      card: change.card || null,
    };
  } else if (change?.type === "sync-updated") {
    payload.delta = {
      fields: Object.keys(change.partial || {}),
      status: state.sync.status,
      lastReason: state.sync.lastReason,
      lastError: state.sync.lastError,
    };
  } else if (change?.type === "webhook-delivery") {
    payload.delta = {
      deliveryId: change.deliveryId || null,
      receivedAt: change.receivedAt || null,
    };
  } else if (change?.type === "replay") {
    payload.board = buildBoardPayload(state, now);
  }

  return payload;
}

module.exports = {
  buildAdminStatusPayload,
  buildBoardPayload,
  buildFiltersPayload,
  buildHealthPayload,
  buildMissionControlEventPayload,
  buildSyncPayload,
  getLagSummary,
  normalizeMissionControlState,
};
