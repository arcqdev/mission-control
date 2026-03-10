const fs = require("fs");
const path = require("path");

const {
  CARDS_SNAPSHOT_FILENAME,
  EVENT_LOG_FILENAME,
  EVENT_VERSION,
  REGISTRY_SNAPSHOT_FILENAME,
  STORE_VERSION,
  SYNC_STATE_FILENAME,
  appendJsonl,
  atomicWriteJson,
  readJsonDocument,
  readJsonlEvents,
  stableStringify,
} = require("../store");

const RECENT_DELIVERY_LIMIT = 100;

function isoNow(now = Date.now) {
  return new Date(now()).toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
    parentIssue: input.parentIssue
      ? {
          id: input.parentIssue.id || null,
          identifier: input.parentIssue.identifier || null,
          title: input.parentIssue.title || "Untitled",
          updatedAt: input.parentIssue.updatedAt || null,
          completedAt: input.parentIssue.completedAt || null,
          canceledAt: input.parentIssue.canceledAt || null,
          archivedAt: input.parentIssue.archivedAt || null,
          state: input.parentIssue.state
            ? {
                id: input.parentIssue.state.id || null,
                name: input.parentIssue.state.name || null,
                type: input.parentIssue.state.type || null,
                color: input.parentIssue.state.color || null,
              }
            : null,
          project: input.parentIssue.project
            ? {
                id: input.parentIssue.project.id || null,
                name: input.parentIssue.project.name || null,
                slug: input.parentIssue.project.slug || null,
                progress: input.parentIssue.project.progress ?? null,
              }
            : null,
          labels: Array.isArray(input.parentIssue.labels)
            ? input.parentIssue.labels
                .map((label) => ({
                  id: label.id || null,
                  name: label.name || null,
                  color: label.color || null,
                }))
                .sort((left, right) => (left.name || "").localeCompare(right.name || ""))
            : [],
          linkRole: input.parentIssue.linkRole || "parent",
          relationType: input.parentIssue.relationType || null,
        }
      : null,
    linkedIssues: Array.isArray(input.linkedIssues)
      ? input.linkedIssues
          .map((issue) => ({
            id: issue.id || null,
            identifier: issue.identifier || null,
            title: issue.title || "Untitled",
            updatedAt: issue.updatedAt || null,
            completedAt: issue.completedAt || null,
            canceledAt: issue.canceledAt || null,
            archivedAt: issue.archivedAt || null,
            state: issue.state
              ? {
                  id: issue.state.id || null,
                  name: issue.state.name || null,
                  type: issue.state.type || null,
                  color: issue.state.color || null,
                }
              : null,
            project: issue.project
              ? {
                  id: issue.project.id || null,
                  name: issue.project.name || null,
                  slug: issue.project.slug || null,
                  progress: issue.project.progress ?? null,
                }
              : null,
            labels: Array.isArray(issue.labels)
              ? issue.labels
                  .map((label) => ({
                    id: label.id || null,
                    name: label.name || null,
                    color: label.color || null,
                  }))
                  .sort((left, right) => (left.name || "").localeCompare(right.name || ""))
              : [],
            linkRole: issue.linkRole || "related",
            relationType: issue.relationType || null,
          }))
          .sort((left, right) =>
            (left.identifier || left.id || "").localeCompare(right.identifier || right.id || ""),
          )
      : [],
    linkedIssueIds: Array.isArray(input.linkedIssueIds)
      ? [...new Set(input.linkedIssueIds.filter(Boolean))].sort((left, right) =>
          left.localeCompare(right),
        )
      : [],
    linkedIssueIdentifiers: Array.isArray(input.linkedIssueIdentifiers)
      ? [...new Set(input.linkedIssueIdentifiers.filter(Boolean))].sort((left, right) =>
          left.localeCompare(right),
        )
      : [],
    linkedIssueProjectSlugs: Array.isArray(input.linkedIssueProjectSlugs)
      ? [...new Set(input.linkedIssueProjectSlugs.filter(Boolean))].sort((left, right) =>
          left.localeCompare(right),
        )
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

function createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook, registry = null }) {
  return {
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    registry,
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

function mergeSync(current, partial) {
  return {
    ...current,
    ...partial,
    persistence: {
      ...current.persistence,
      ...(partial.persistence || {}),
    },
    webhook: {
      ...current.webhook,
      ...(partial.webhook || {}),
    },
  };
}

function createRegistrySnapshot(registry, now) {
  return {
    kind: "mission-control.registry.snapshot",
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    registry,
  };
}

function createCardsSnapshot(snapshot, now) {
  return {
    kind: "mission-control.cards.snapshot",
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    eventCount: snapshot.eventCount,
    cards: snapshot.cards,
  };
}

function createSyncStateSnapshot(snapshot, now) {
  return {
    kind: "mission-control.sync-state",
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    sync: snapshot.sync,
  };
}

function applyEvent(snapshot, event) {
  snapshot.eventCount = Math.max(
    snapshot.eventCount,
    Number(event.sequence || snapshot.eventCount + 1),
  );

  switch (event.type) {
    case "mission-control.registry.bootstrapped":
      snapshot.registry = event.payload?.registry || snapshot.registry;
      break;
    case "mission-control.linear.card-upserted":
      if (event.payload?.card?.id) {
        snapshot.cards[event.payload.card.id] = event.payload.card;
      }
      break;
    case "mission-control.linear.webhook.received":
    case "mission-control.linear.webhook.duplicate":
      snapshot.sync.lastWebhookAt = event.payload?.receivedAt || event.occurredAt || null;
      snapshot.sync.webhook.lastDeliveryId = event.deliveryId || null;
      if (Array.isArray(event.payload?.recentDeliveryIds)) {
        snapshot.sync.webhook.recentDeliveryIds = event.payload.recentDeliveryIds;
      }
      break;
    default:
      if (event.payload?.sync) {
        snapshot.sync = mergeSync(snapshot.sync, event.payload.sync);
      }
      break;
  }
}

function createLinearSyncStore({
  dataDir,
  now = Date.now,
  pollIntervalMs,
  projectSlugs,
  webhook,
  registry = null,
  onChange = () => {},
}) {
  const syncDir = path.join(dataDir, "mission-control");
  const registrySnapshotPath = path.join(syncDir, REGISTRY_SNAPSHOT_FILENAME);
  const cardsSnapshotPath = path.join(syncDir, CARDS_SNAPSHOT_FILENAME);
  const syncStatePath = path.join(syncDir, SYNC_STATE_FILENAME);
  const eventLogPath = path.join(syncDir, EVENT_LOG_FILENAME);

  let persistenceEnabled = true;
  let snapshot = createInitialSnapshot({ now, pollIntervalMs, projectSlugs, webhook, registry });
  let loadedRegistry = null;
  const initializationWarnings = [];

  try {
    ensureDir(syncDir);
  } catch (error) {
    persistenceEnabled = false;
    snapshot.sync.lastError = `Linear snapshot persistence unavailable: ${error.message}`;
    snapshot.sync.persistence.enabled = false;
    snapshot.sync.persistence.lastWriteError = error.message;
  }

  try {
    loadedRegistry = readJsonDocument(registrySnapshotPath, {
      kind: "mission-control.registry.snapshot",
      version: STORE_VERSION,
    });
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  try {
    const cardsDoc = readJsonDocument(cardsSnapshotPath, {
      kind: "mission-control.cards.snapshot",
      version: STORE_VERSION,
    });
    if (cardsDoc) {
      snapshot.cards = cardsDoc.cards || {};
      snapshot.eventCount = Number(cardsDoc.eventCount || 0);
    }
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  try {
    const syncDoc = readJsonDocument(syncStatePath, {
      kind: "mission-control.sync-state",
      version: STORE_VERSION,
    });
    if (syncDoc?.sync) {
      snapshot.sync = mergeSync(snapshot.sync, syncDoc.sync);
    }
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  if (!snapshot.registry && loadedRegistry?.registry) {
    snapshot.registry = loadedRegistry.registry;
  }

  try {
    const events = readJsonlEvents(eventLogPath);
    if (events.length > 0) {
      snapshot = createInitialSnapshot({
        now,
        pollIntervalMs,
        projectSlugs,
        webhook,
        registry: snapshot.registry,
      });
      for (const event of events) {
        applyEvent(snapshot, event);
      }
    }
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  if (initializationWarnings.length > 0) {
    snapshot.sync.status = snapshot.sync.status === "disabled" ? "disabled" : "error";
    snapshot.sync.lastError = initializationWarnings.join("; ");
    snapshot.sync.persistence.lastWriteError = initializationWarnings.join("; ");
  }

  function computeLagMs() {
    if (!snapshot.sync.lastSuccessfulAt) return null;
    return Math.max(0, now() - Date.parse(snapshot.sync.lastSuccessfulAt));
  }

  function persistSnapshots() {
    snapshot.updatedAt = isoNow(now);
    snapshot.sync.persistence.enabled = persistenceEnabled;
    if (!persistenceEnabled) {
      return;
    }

    try {
      if (snapshot.registry) {
        atomicWriteJson(registrySnapshotPath, createRegistrySnapshot(snapshot.registry, now));
      }
      atomicWriteJson(cardsSnapshotPath, createCardsSnapshot(snapshot, now));
      atomicWriteJson(syncStatePath, createSyncStateSnapshot(snapshot, now));
      snapshot.sync.persistence.lastWriteAt = isoNow(now);
      snapshot.sync.persistence.lastWriteError = null;
    } catch (error) {
      persistenceEnabled = false;
      snapshot.sync.persistence.enabled = false;
      snapshot.sync.persistence.lastWriteError = error.message;
      snapshot.sync.lastError = `Failed to persist Linear snapshot: ${error.message}`;
    }
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

  function appendAuditEvent(type, payload = {}, context = {}) {
    snapshot.eventCount += 1;
    const event = {
      version: EVENT_VERSION,
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
      appendJsonl(eventLogPath, event);
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
    return readJsonlEvents(eventLogPath);
  }

  function bootstrap() {
    const registryChanged =
      snapshot.registry &&
      stableStringify(snapshot.registry) !== stableStringify(loadedRegistry?.registry || null);
    const logMissing = !fs.existsSync(eventLogPath);

    if (snapshot.registry && (registryChanged || logMissing)) {
      appendAuditEvent(
        "mission-control.registry.bootstrapped",
        { registry: snapshot.registry },
        { source: "startup" },
      );
    }

    persistSnapshots();
    return getPublicState();
  }

  function noteWebhookDelivery({ deliveryId, receivedAt, issue, duplicate = false }) {
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

    appendAuditEvent(
      duplicate
        ? "mission-control.linear.webhook.duplicate"
        : "mission-control.linear.webhook.received",
      {
        projectSlug: issue?.project?.slug || null,
        receivedAt,
        recentDeliveryIds: snapshot.sync.webhook.recentDeliveryIds,
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
    persistSnapshots();
    emitChange({ type: "webhook-delivery", deliveryId, receivedAt, duplicate });
  }

  function hasSeenWebhookDelivery(deliveryId) {
    if (!deliveryId) return false;
    return snapshot.sync.webhook.recentDeliveryIds.includes(deliveryId);
  }

  function updateSync(partial, audit = {}) {
    snapshot.sync = mergeSync(snapshot.sync, partial);
    snapshot.sync.lagMs = computeLagMs();

    if (audit.type) {
      appendAuditEvent(
        audit.type,
        {
          ...(audit.payload || {}),
          sync: partial,
        },
        {
          occurredAt: audit.occurredAt,
          source: audit.source,
          cardId: audit.cardId,
          issueId: audit.issueId,
          identifier: audit.identifier,
          deliveryId: audit.deliveryId,
        },
      );
    }

    persistSnapshots();
    emitChange({
      type: "sync-updated",
      partial,
      sync: snapshot.sync,
      source: audit.source || partial.lastReason || null,
      auditType: audit.type || null,
      occurredAt: audit.occurredAt || isoNow(now),
    });
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
      persistSnapshots();
      emitChange({
        type: "card-observed",
        source: context.source || null,
        cardId,
        issueId: normalizedCard.id,
      });
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
    persistSnapshots();
    emitChange({
      type: "card-upserted",
      card,
      source: context.source || null,
      cardId: card.id,
      issueId: normalizedCard.id,
      action,
    });

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
      registry: snapshot.registry,
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
    bootstrap,
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
