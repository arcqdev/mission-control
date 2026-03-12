const fs = require("fs");
const path = require("path");

const SNAPSHOT_VERSION = 1;
const SNAPSHOT_FILENAME = "linear-sync-snapshot.json";
const EVENT_LOG_FILENAME = "linear-sync-events.jsonl";
const RECENT_DELIVERY_LIMIT = 100;

function isoNow(now = Date.now) {
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

function stableStringify(value, spacing = 0) {
  return JSON.stringify(sortObject(value), null, spacing);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function atomicWriteJson(filePath, value) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${stableStringify(value, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${stableStringify(value)}\n`, "utf8");
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
      persistence: {
        enabled: true,
        lastWriteAt: null,
        lastWriteError: null,
      },
      webhook: {
        enabled: Boolean(webhook?.enabled),
        path: webhook?.path || null,
        lastDeliveryId: null,
        recentDeliveryIds: [],
      },
    },
  };
}

function createLinearSyncStore({ dataDir, now = Date.now, pollIntervalMs, projectSlugs, webhook }) {
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
    snapshot.sync.persistence.enabled = false;
    snapshot.sync.persistence.lastWriteError = error.message;
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
          persistence: {
            ...snapshot.sync.persistence,
            ...(loaded.sync?.persistence || {}),
          },
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
    snapshot.sync.persistence.lastWriteError = error.message;
  }

  function computeLagMs() {
    if (!snapshot.sync.lastSuccessfulAt) return null;
    return Math.max(0, now() - Date.parse(snapshot.sync.lastSuccessfulAt));
  }

  function persistSnapshot() {
    snapshot.updatedAt = isoNow(now);
    snapshot.sync.persistence.enabled = persistenceEnabled;
    if (!persistenceEnabled) {
      return;
    }

    try {
      atomicWriteJson(snapshotPath, snapshot);
      snapshot.sync.persistence.lastWriteAt = isoNow(now);
      snapshot.sync.persistence.lastWriteError = null;
    } catch (error) {
      persistenceEnabled = false;
      snapshot.sync.persistence.enabled = false;
      snapshot.sync.persistence.lastWriteError = error.message;
      snapshot.sync.lastError = `Failed to persist Linear snapshot: ${error.message}`;
    }
  }

  function appendAuditEvent(type, payload = {}, context = {}) {
    snapshot.eventCount += 1;
    const event = {
      sequence: snapshot.eventCount,
      type,
      occurredAt: context.occurredAt || isoNow(now),
      source: context.source || null,
      cardId: context.cardId || null,
      issueId: context.issueId || null,
      identifier: context.identifier || null,
      deliveryId: context.deliveryId || null,
      payload,
    };

    if (!persistenceEnabled) {
      return event;
    }

    try {
      appendJsonLine(eventLogPath, event);
      snapshot.sync.persistence.lastWriteAt = event.occurredAt;
      snapshot.sync.persistence.lastWriteError = null;
    } catch (error) {
      persistenceEnabled = false;
      snapshot.sync.persistence.enabled = false;
      snapshot.sync.persistence.lastWriteError = error.message;
      snapshot.sync.lastError = `Failed to append Linear event log: ${error.message}`;
    }

    return event;
  }

  function readEventLog() {
    if (!fs.existsSync(eventLogPath)) {
      return [];
    }

    return fs
      .readFileSync(eventLogPath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  function noteWebhookDelivery({ deliveryId, receivedAt, issue, duplicate = false }) {
    snapshot.sync.lastWebhookAt = receivedAt;
    snapshot.sync.webhook.lastDeliveryId = deliveryId || null;
    if (deliveryId) {
      snapshot.sync.webhook.recentDeliveryIds = [
        deliveryId,
        ...snapshot.sync.webhook.recentDeliveryIds.filter((existingId) => existingId !== deliveryId),
      ].slice(0, RECENT_DELIVERY_LIMIT);
    }

    appendAuditEvent(
      duplicate ? "mission-control.linear.webhook.duplicate" : "mission-control.linear.webhook.received",
      {
        projectSlug: issue?.project?.slug || null,
      },
      {
        occurredAt: receivedAt,
        source: "webhook",
        cardId: issue?.id ? `mc:${issue.id}` : null,
        issueId: issue?.id || null,
        identifier: issue?.identifier || null,
        deliveryId,
      },
    );
    persistSnapshot();
  }

  function hasSeenWebhookDelivery(deliveryId) {
    if (!deliveryId) return false;
    return snapshot.sync.webhook.recentDeliveryIds.includes(deliveryId);
  }

  function updateSync(partial, audit = {}) {
    snapshot.sync = {
      ...snapshot.sync,
      ...partial,
      persistence: {
        ...snapshot.sync.persistence,
        ...(partial.persistence || {}),
      },
      webhook: {
        ...snapshot.sync.webhook,
        ...(partial.webhook || {}),
      },
    };
    snapshot.sync.lagMs = computeLagMs();

    if (audit.type) {
      appendAuditEvent(audit.type, audit.payload || {}, {
        occurredAt: audit.occurredAt,
        source: audit.source,
        cardId: audit.cardId,
        issueId: audit.issueId,
        identifier: audit.identifier,
        deliveryId: audit.deliveryId,
      });
    }

    persistSnapshot();
  }

  function upsertCard(cardInput, context = {}) {
    const normalizedCard = normalizeCard(cardInput);
    const previous = snapshot.cards[normalizedCard.id] || null;
    const nextFingerprint = stableStringify(normalizedCard);
    const previousFingerprint = previous ? stableStringify(normalizeCard(previous)) : null;
    const receivedAt = context.receivedAt || isoNow(now);
    const cardId = `mc:${normalizedCard.id}`;

    if (previousFingerprint === nextFingerprint) {
      appendAuditEvent(
        "mission-control.linear.card-observed",
        {
          action: "noop",
          state: normalizedCard.state?.name || null,
          projectSlug: normalizedCard.project?.slug || null,
          updatedAt: normalizedCard.updatedAt,
        },
        {
          occurredAt: receivedAt,
          source: context.source || "poller",
          cardId,
          issueId: normalizedCard.id,
          identifier: normalizedCard.identifier,
          deliveryId: context.deliveryId || null,
        },
      );
      persistSnapshot();
      return {
        changed: false,
        action: "noop",
        card: previous,
      };
    }

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
    appendAuditEvent(
      "mission-control.linear.card-upserted",
      {
        action,
        card,
      },
      {
        occurredAt: receivedAt,
        source: context.source || "poller",
        cardId,
        issueId: card.id,
        identifier: card.identifier,
        deliveryId: context.deliveryId || null,
      },
    );
    persistSnapshot();

    return {
      changed: true,
      action,
      card,
    };
  }

  function getTimelineForCard(reference = {}) {
    const wantedCardIds = new Set(
      [reference.cardId, reference.issueId ? `mc:${reference.issueId}` : null].filter(Boolean),
    );
    const wantedIssueIds = new Set([reference.issueId].filter(Boolean));
    const wantedIdentifiers = new Set([reference.identifier].filter(Boolean));

    return readEventLog().filter((event) => {
      if (event.type.startsWith("mission-control.linear.reconcile.")) {
        return true;
      }
      if (wantedCardIds.size > 0 && wantedCardIds.has(event.cardId)) {
        return true;
      }
      if (wantedIssueIds.size > 0 && wantedIssueIds.has(event.issueId)) {
        return true;
      }
      if (wantedIdentifiers.size > 0 && wantedIdentifiers.has(event.identifier)) {
        return true;
      }
      return false;
    });
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
    appendAuditEvent,
    getSnapshot,
    getPublicState,
    getTimelineForCard,
    hasSeenWebhookDelivery,
    noteWebhookDelivery,
    readEventLog,
    updateSync,
    upsertCard,
  };
}

module.exports = {
  atomicWriteJson,
  createLinearSyncStore,
  normalizeCard,
};
