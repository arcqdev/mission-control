const fs = require("fs");
const path = require("path");

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILENAME = "linear-sync-snapshot.json";
const EVENT_LOG_FILENAME = "linear-sync-events.jsonl";
const RECENT_DELIVERY_LIMIT = 100;

function isoNow(now) {
  return new Date(now()).toISOString();
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function normalizeCard(input) {
  return {
    source: "linear",
    id: input.id,
    identifier: input.identifier,
    title: input.title || "Untitled",
    description: input.description || "",
    url: input.url || null,
    priority: input.priority ?? null,
    estimate: input.estimate ?? null,
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null,
    startedAt: input.startedAt || null,
    completedAt: input.completedAt || null,
    canceledAt: input.canceledAt || null,
    archivedAt: input.archivedAt || null,
    state: input.state
      ? {
          id: input.state.id || null,
          name: input.state.name || null,
          type: input.state.type || null,
          color: input.state.color || null,
        }
      : null,
    project: input.project
      ? {
          id: input.project.id || null,
          name: input.project.name || null,
          slug: input.project.slug || null,
          progress: input.project.progress ?? null,
        }
      : null,
    team: input.team
      ? {
          id: input.team.id || null,
          key: input.team.key || null,
          name: input.team.name || null,
        }
      : null,
    assignee: input.assignee
      ? {
          id: input.assignee.id || null,
          name: input.assignee.name || null,
          email: input.assignee.email || null,
        }
      : null,
    labels: Array.isArray(input.labels)
      ? input.labels
          .map((label) => ({
            id: label.id || null,
            name: label.name || null,
            color: label.color || null,
          }))
          .sort((left, right) => (left.name || "").localeCompare(right.name || ""))
      : [],
    cycle: input.cycle
      ? {
          id: input.cycle.id || null,
          number: input.cycle.number ?? null,
          name: input.cycle.name || null,
          startsAt: input.cycle.startsAt || null,
          endsAt: input.cycle.endsAt || null,
        }
      : null,
  };
}

function createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook }) {
  return {
    version: SNAPSHOT_VERSION,
    updatedAt: isoNow(now),
    cards: {},
    eventCount: 0,
    sync: {
      status: "idle",
      mode: "hybrid",
      pollIntervalMs,
      projectSlugs: [...projectSlugs],
      cursor: {
        updatedAfter: null,
      },
      lastAttemptedAt: null,
      lastSuccessfulAt: null,
      lastWebhookAt: null,
      lastError: null,
      lastReason: null,
      lastFetchedCount: 0,
      lastChangedCount: 0,
      lagMs: null,
      webhook: {
        enabled: Boolean(webhook?.enabled),
        path: webhook?.path || null,
        lastDeliveryId: null,
        recentDeliveryIds: [],
      },
    },
  };
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function createLinearSyncStore({
  dataDir,
  now = Date.now,
  pollIntervalMs,
  projectSlugs,
  webhook,
  onChange = () => {},
}) {
  const syncDir = path.join(dataDir, "mission-control");
  const snapshotPath = path.join(syncDir, SNAPSHOT_FILENAME);
  const eventLogPath = path.join(syncDir, EVENT_LOG_FILENAME);

  let persistenceEnabled = true;
  let snapshot = createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook });

  try {
    ensureDir(syncDir);
  } catch (error) {
    persistenceEnabled = false;
    snapshot.sync.lastError = `Linear snapshot persistence unavailable: ${error.message}`;
  }

  try {
    if (persistenceEnabled && fs.existsSync(snapshotPath)) {
      const loaded = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      snapshot = {
        ...snapshot,
        ...loaded,
        cards: loaded.cards || {},
        sync: {
          ...snapshot.sync,
          ...(loaded.sync || {}),
          webhook: {
            ...snapshot.sync.webhook,
            ...(loaded.sync?.webhook || {}),
          },
        },
      };
    }
  } catch (error) {
    snapshot.sync.status = "error";
    snapshot.sync.lastError = `Failed to load Linear snapshot: ${error.message}`;
  }

  function emitChange(change) {
    try {
      onChange({
        ...change,
        publicState: getPublicState(),
      });
    } catch (_error) {
      // Keep store mutations resilient even if listeners fail.
    }
  }

  function persistSnapshot() {
    snapshot.updatedAt = isoNow(now);
    if (!persistenceEnabled) return;

    try {
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      persistenceEnabled = false;
      snapshot.sync.lastError = `Failed to persist Linear snapshot: ${error.message}`;
    }
  }

  function appendEvent(event) {
    snapshot.eventCount += 1;
    if (!persistenceEnabled) return;

    try {
      fs.appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`);
    } catch (error) {
      persistenceEnabled = false;
      snapshot.sync.lastError = `Failed to append Linear event log: ${error.message}`;
    }
  }

  function computeLagMs() {
    if (!snapshot.sync.lastSuccessfulAt) return null;
    return Math.max(0, now() - Date.parse(snapshot.sync.lastSuccessfulAt));
  }

  function noteWebhookDelivery({ deliveryId, receivedAt }) {
    snapshot.sync.lastWebhookAt = receivedAt;
    snapshot.sync.webhook.lastDeliveryId = deliveryId || null;
    if (deliveryId) {
      snapshot.sync.webhook.recentDeliveryIds = [
        deliveryId,
        ...snapshot.sync.webhook.recentDeliveryIds.filter(
          (existingId) => existingId !== deliveryId,
        ),
      ].slice(0, RECENT_DELIVERY_LIMIT);
    }
    persistSnapshot();
    emitChange({ type: "webhook-delivery", deliveryId, receivedAt });
  }

  function hasSeenWebhookDelivery(deliveryId) {
    if (!deliveryId) return false;
    return snapshot.sync.webhook.recentDeliveryIds.includes(deliveryId);
  }

  function updateSync(partial) {
    snapshot.sync = {
      ...snapshot.sync,
      ...partial,
      webhook: {
        ...snapshot.sync.webhook,
        ...(partial.webhook || {}),
      },
    };
    snapshot.sync.lagMs = computeLagMs();
    persistSnapshot();
    emitChange({ type: "sync-updated", partial, sync: snapshot.sync });
  }

  function upsertCard(cardInput, context = {}) {
    const normalizedCard = normalizeCard(cardInput);
    const previous = snapshot.cards[normalizedCard.id] || null;
    const nextFingerprint = stableStringify(normalizedCard);
    const previousFingerprint = previous ? stableStringify(normalizeCard(previous)) : null;

    if (previousFingerprint === nextFingerprint) {
      return {
        changed: false,
        action: "noop",
        card: previous,
      };
    }

    const receivedAt = context.receivedAt || isoNow(now);
    const action = previous ? "updated" : "created";
    const card = {
      ...(previous || {}),
      ...normalizedCard,
      firstSeenAt: previous?.firstSeenAt || receivedAt,
      lastMaterializedAt: receivedAt,
      lastSource: context.source || "poller",
      lastDeliveryId: context.deliveryId || null,
    };

    snapshot.cards[card.id] = card;
    appendEvent({
      type: "mission-control.linear.card-upserted",
      action,
      timestamp: receivedAt,
      source: context.source || "poller",
      deliveryId: context.deliveryId || null,
      cardId: card.id,
      identifier: card.identifier,
      updatedAt: card.updatedAt,
      projectSlug: card.project?.slug || null,
      state: card.state?.name || null,
    });
    persistSnapshot();
    emitChange({ type: "card-upserted", action, card, context });

    return {
      changed: true,
      action,
      card,
    };
  }

  function getPublicState() {
    const cards = Object.values(snapshot.cards).sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.lastMaterializedAt || 0);
      const rightTime = Date.parse(right.updatedAt || right.lastMaterializedAt || 0);
      return rightTime - leftTime;
    });

    return {
      masterCards: cards,
      stats: {
        totalCards: cards.length,
        eventCount: snapshot.eventCount,
      },
      sync: {
        ...snapshot.sync,
        lagMs: computeLagMs(),
      },
    };
  }

  function getSnapshot() {
    return snapshot;
  }

  return {
    getSnapshot,
    getPublicState,
    hasSeenWebhookDelivery,
    noteWebhookDelivery,
    updateSync,
    upsertCard,
  };
}

module.exports = { createLinearSyncStore, normalizeCard };
