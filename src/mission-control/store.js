const fs = require("fs");
const path = require("path");

const STORE_VERSION = 1;
const EVENT_VERSION = 1;
const REGISTRY_SNAPSHOT_FILENAME = "registry.snapshot.json";
const CARDS_SNAPSHOT_FILENAME = "cards.snapshot.json";
const SYNC_STATE_FILENAME = "sync-state.json";
const EVENT_LOG_FILENAME = "card-events.jsonl";
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

function stableStringify(value) {
  return JSON.stringify(sortObject(value));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function syncDirectory(dirPath) {
  try {
    const fd = fs.openSync(dirPath, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_error) {
    // Directory fsync is best-effort and platform-specific.
  }
}

function atomicWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(sortObject(value), null, 2)}\n`;
  let fd = null;

  try {
    fd = fs.openSync(tempPath, "w");
    fs.writeSync(fd, payload, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }

  try {
    fs.renameSync(tempPath, filePath);
    syncDirectory(path.dirname(filePath));
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_unlinkError) {
      // Ignore cleanup errors after a failed atomic rename.
    }
    throw error;
  }
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  const line = `${stableStringify(value)}\n`;
  let fd = null;

  try {
    fd = fs.openSync(filePath, "a");
    fs.writeSync(fd, line, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    if (fd !== null) {
      fs.closeSync(fd);
    }
  }

  syncDirectory(path.dirname(filePath));
}

function validateVersionedDocument(document, { filePath, kind, version }) {
  if (!document || typeof document !== "object") {
    throw new Error(`${path.basename(filePath)} is not a valid JSON object`);
  }
  if (document.kind !== kind) {
    throw new Error(`${path.basename(filePath)} has kind ${document.kind || "unknown"}, expected ${kind}`);
  }
  if (document.version !== version) {
    throw new Error(
      `${path.basename(filePath)} has unsupported version ${document.version}; expected ${version}`,
    );
  }
  return document;
}

function readJsonDocument(filePath, options) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return validateVersionedDocument(parsed, { filePath, ...options });
}

function readJsonlEvents(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      const parsed = JSON.parse(line);
      if (parsed.version !== EVENT_VERSION) {
        throw new Error(
          `${path.basename(filePath)} line ${index + 1} has unsupported version ${parsed.version}`,
        );
      }
      return parsed;
    });
}

function stripPersistenceMetadata(card) {
  if (!card || typeof card !== "object") return card;

  const clone = { ...card };
  delete clone.firstSeenAt;
  delete clone.lastMaterializedAt;
  delete clone.lastSource;
  delete clone.lastDeliveryId;
  return clone;
}

function createInitialSyncState({ pollIntervalMs, projectSlugs, webhook }) {
  return {
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
  };
}

function mergeSyncState(current, partial) {
  return {
    ...current,
    ...partial,
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

function createCardsSnapshot(cards, eventCount, now) {
  return {
    kind: "mission-control.cards.snapshot",
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    eventCount,
    cards,
  };
}

function createSyncStateSnapshot(sync, now) {
  return {
    kind: "mission-control.sync-state",
    version: STORE_VERSION,
    updatedAt: isoNow(now),
    sync,
  };
}

function createEvent(kind, payload, now, timestamp) {
  return {
    kind,
    version: EVENT_VERSION,
    timestamp: timestamp || isoNow(now),
    payload,
  };
}

function replayEventLog({ events, registry, syncDefaults }) {
  const state = {
    registry,
    cards: {},
    eventCount: 0,
    sync: createInitialSyncState(syncDefaults),
  };

  for (const event of events) {
    switch (event.kind) {
      case "mission-control.registry.persisted":
        state.registry = event.payload.registry;
        break;
      case "mission-control.card-upserted":
        state.cards[event.payload.card.id] = event.payload.card;
        state.eventCount += 1;
        break;
      case "mission-control.sync-updated":
        state.sync = mergeSyncState(state.sync, event.payload.sync);
        break;
      case "mission-control.webhook-delivery":
        state.sync.lastWebhookAt = event.payload.receivedAt;
        state.sync.webhook.lastDeliveryId = event.payload.deliveryId || null;
        state.sync.webhook.recentDeliveryIds = Array.isArray(event.payload.recentDeliveryIds)
          ? event.payload.recentDeliveryIds
          : state.sync.webhook.recentDeliveryIds;
        break;
      default:
        throw new Error(`Unsupported Mission Control event kind: ${event.kind}`);
    }
  }

  return state;
}

function createMissionControlStore({
  dataDir,
  registry,
  syncDefaults,
  now = Date.now,
  onChange = () => {},
}) {
  const storeDir = path.join(dataDir, "mission-control");
  const registrySnapshotPath = path.join(storeDir, REGISTRY_SNAPSHOT_FILENAME);
  const cardsSnapshotPath = path.join(storeDir, CARDS_SNAPSHOT_FILENAME);
  const syncStatePath = path.join(storeDir, SYNC_STATE_FILENAME);
  const eventLogPath = path.join(storeDir, EVENT_LOG_FILENAME);

  ensureDir(storeDir);

  let state = {
    registry,
    cards: {},
    eventCount: 0,
    sync: createInitialSyncState(syncDefaults),
  };

  const initializationWarnings = [];
  let loadedRegistrySnapshot = null;
  let cardsSnapshot = null;
  let syncStateSnapshot = null;

  try {
    loadedRegistrySnapshot = readJsonDocument(registrySnapshotPath, {
      kind: "mission-control.registry.snapshot",
      version: STORE_VERSION,
    });
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  try {
    cardsSnapshot = readJsonDocument(cardsSnapshotPath, {
      kind: "mission-control.cards.snapshot",
      version: STORE_VERSION,
    });
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  try {
    syncStateSnapshot = readJsonDocument(syncStatePath, {
      kind: "mission-control.sync-state",
      version: STORE_VERSION,
    });
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  try {
    const events = readJsonlEvents(eventLogPath);
    if (events.length > 0) {
      state = replayEventLog({ events, registry, syncDefaults });
    } else {
      state = {
        registry,
        cards: cardsSnapshot?.cards || {},
        eventCount: Number(cardsSnapshot?.eventCount || 0),
        sync: syncStateSnapshot?.sync
          ? mergeSyncState(createInitialSyncState(syncDefaults), syncStateSnapshot.sync)
          : createInitialSyncState(syncDefaults),
      };
    }
  } catch (error) {
    initializationWarnings.push(error.message);
  }

  if (initializationWarnings.length > 0) {
    state.sync.status = "error";
    state.sync.lastError = initializationWarnings.join("; ");
  }

  function computeLagMs() {
    if (!state.sync.lastSuccessfulAt) return null;
    return Math.max(0, now() - Date.parse(state.sync.lastSuccessfulAt));
  }

  function emitChange(change) {
    try {
      onChange({
        ...change,
        publicState: getPublicState(),
      });
    } catch (_error) {
      // Listener failures must not break Mission Control state transitions.
    }
  }

  function persistRegistrySnapshot({ emitEvent = false, reason = "startup" } = {}) {
    atomicWriteJson(registrySnapshotPath, createRegistrySnapshot(state.registry, now));
    if (emitEvent) {
      appendJsonl(
        eventLogPath,
        createEvent(
          "mission-control.registry.persisted",
          {
            reason,
            registry: state.registry,
          },
          now,
        ),
      );
      emitChange({ type: "registry-persisted", reason });
    }
  }

  function persistCardsSnapshot() {
    atomicWriteJson(cardsSnapshotPath, createCardsSnapshot(state.cards, state.eventCount, now));
  }

  function persistSyncSnapshot() {
    atomicWriteJson(syncStatePath, createSyncStateSnapshot(state.sync, now));
  }

  function bootstrap() {
    const registryHasChanged =
      !loadedRegistrySnapshot ||
      stableStringify(loadedRegistrySnapshot.registry) !== stableStringify(state.registry);
    const eventLogMissing = !fs.existsSync(eventLogPath);

    persistRegistrySnapshot({ emitEvent: registryHasChanged || eventLogMissing, reason: "startup" });
    persistCardsSnapshot();
    persistSyncSnapshot();
    return getPublicState();
  }

  function notePersistenceError(message) {
    state.sync.lastError = message;
    state.sync.status = state.sync.status === "disabled" ? "disabled" : "error";
  }

  function hasSeenWebhookDelivery(deliveryId) {
    if (!deliveryId) return false;
    return state.sync.webhook.recentDeliveryIds.includes(deliveryId);
  }

  function noteWebhookDelivery({ deliveryId, receivedAt }) {
    const recentDeliveryIds = deliveryId
      ? [
          deliveryId,
          ...state.sync.webhook.recentDeliveryIds.filter((existingId) => existingId !== deliveryId),
        ].slice(0, RECENT_DELIVERY_LIMIT)
      : state.sync.webhook.recentDeliveryIds;

    state.sync = mergeSyncState(state.sync, {
      lastWebhookAt: receivedAt,
      webhook: {
        lastDeliveryId: deliveryId || null,
        recentDeliveryIds,
      },
    });

    try {
      appendJsonl(
        eventLogPath,
        createEvent(
          "mission-control.webhook-delivery",
          {
            deliveryId: deliveryId || null,
            receivedAt,
            recentDeliveryIds,
          },
          now,
          receivedAt,
        ),
      );
      persistSyncSnapshot();
    } catch (error) {
      notePersistenceError(`Failed to append Mission Control webhook event: ${error.message}`);
    }

    emitChange({ type: "webhook-delivery", deliveryId, receivedAt });
  }

  function updateSync(partial) {
    state.sync = mergeSyncState(state.sync, partial);
    state.sync.lagMs = computeLagMs();

    try {
      appendJsonl(
        eventLogPath,
        createEvent(
          "mission-control.sync-updated",
          {
            sync: partial,
          },
          now,
          partial.lastSuccessfulAt || partial.lastAttemptedAt || partial.lastWebhookAt || undefined,
        ),
      );
      persistSyncSnapshot();
    } catch (error) {
      notePersistenceError(`Failed to persist Mission Control sync state: ${error.message}`);
    }

    emitChange({ type: "sync-updated", partial, sync: state.sync });
  }

  function upsertCard(cardInput, context = {}) {
    const previous = state.cards[cardInput.id] || null;
    const nextFingerprint = stableStringify(stripPersistenceMetadata(cardInput));
    const previousFingerprint = previous
      ? stableStringify(stripPersistenceMetadata(previous))
      : null;

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
      ...cardInput,
      firstSeenAt: previous?.firstSeenAt || receivedAt,
      lastMaterializedAt: receivedAt,
      lastSource: context.source || "poller",
      lastDeliveryId: context.deliveryId || null,
    };

    state.cards[card.id] = card;
    state.eventCount += 1;

    try {
      appendJsonl(
        eventLogPath,
        createEvent(
          "mission-control.card-upserted",
          {
            action,
            card,
            source: context.source || "poller",
            deliveryId: context.deliveryId || null,
          },
          now,
          receivedAt,
        ),
      );
      persistCardsSnapshot();
    } catch (error) {
      notePersistenceError(`Failed to persist Mission Control card state: ${error.message}`);
    }

    emitChange({ type: "card-upserted", action, card, context });

    return {
      changed: true,
      action,
      card,
    };
  }

  function getCards() {
    return Object.values(state.cards).sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.lastMaterializedAt || 0);
      const rightTime = Date.parse(right.updatedAt || right.lastMaterializedAt || 0);
      return rightTime - leftTime;
    });
  }

  function getPublicState() {
    return {
      updatedAt: state.sync.lastSuccessfulAt || null,
      registry: state.registry,
      masterCards: getCards(),
      stats: {
        totalCards: getCards().length,
        eventCount: state.eventCount,
      },
      sync: {
        ...state.sync,
        lagMs: computeLagMs(),
      },
    };
  }

  function getSnapshot() {
    return {
      version: STORE_VERSION,
      registry: state.registry,
      cards: state.cards,
      eventCount: state.eventCount,
      sync: state.sync,
    };
  }

  function getRegistry() {
    return state.registry;
  }

  return {
    bootstrap,
    getPublicState,
    getRegistry,
    getSnapshot,
    hasSeenWebhookDelivery,
    noteWebhookDelivery,
    updateSync,
    upsertCard,
  };
}

module.exports = {
  CARDS_SNAPSHOT_FILENAME,
  EVENT_LOG_FILENAME,
  EVENT_VERSION,
  REGISTRY_SNAPSHOT_FILENAME,
  RECENT_DELIVERY_LIMIT,
  STORE_VERSION,
  SYNC_STATE_FILENAME,
  appendJsonl,
  atomicWriteJson,
  createInitialSyncState,
  createMissionControlStore,
  createRegistrySnapshot,
  createCardsSnapshot,
  createSyncStateSnapshot,
  isoNow,
  readJsonDocument,
  readJsonlEvents,
  replayEventLog,
  stableStringify,
  stripPersistenceMetadata,
  validateVersionedDocument,
};
