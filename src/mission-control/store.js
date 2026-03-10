const fs = require("fs");
const path = require("path");

const {
  MISSION_CONTROL_SCHEMA_VERSION,
  normalizeMasterCard,
  normalizeProjectRegistryEntry,
  toIsoTimestamp,
} = require("./models");

const REGISTRY_SNAPSHOT_KIND = "mission-control.registry.snapshot";
const CARDS_SNAPSHOT_KIND = "mission-control.cards.snapshot";
const EVENT_LOG_KIND = "mission-control.card-event";

function getMissionControlStorePaths(dataDir) {
  const rootDir = path.join(dataDir, "mission-control");

  return {
    rootDir,
    registrySnapshot: path.join(rootDir, "registry.snapshot.json"),
    cardsSnapshot: path.join(rootDir, "cards.snapshot.json"),
    eventLog: path.join(rootDir, "card-events.jsonl"),
  };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((result, key) => {
        result[key] = sortValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function stableStringify(value, spacing = 2) {
  return JSON.stringify(sortValue(value), null, spacing);
}

function fsyncDirectory(dirPath) {
  let directoryDescriptor = null;

  try {
    directoryDescriptor = fs.openSync(dirPath, "r");
    fs.fsyncSync(directoryDescriptor);
  } catch (_error) {
    // Directory fsync is best-effort across platforms.
  } finally {
    if (directoryDescriptor !== null) {
      fs.closeSync(directoryDescriptor);
    }
  }
}

function atomicWriteJson(filePath, value) {
  const dirPath = path.dirname(filePath);
  ensureDirectory(dirPath);

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${stableStringify(value)}
`;
  let fileDescriptor = null;

  try {
    fileDescriptor = fs.openSync(tempPath, "w");
    fs.writeFileSync(fileDescriptor, content, "utf8");
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = null;
    fs.renameSync(tempPath, filePath);
    fsyncDirectory(dirPath);
  } catch (error) {
    if (fileDescriptor !== null) {
      fs.closeSync(fileDescriptor);
    }
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

function appendJsonLine(filePath, value) {
  ensureDirectory(path.dirname(filePath));

  const fileDescriptor = fs.openSync(filePath, "a");

  try {
    fs.writeSync(fileDescriptor, `${stableStringify(value, 0)}\n`, null, "utf8");
    fs.fsyncSync(fileDescriptor);
  } finally {
    fs.closeSync(fileDescriptor);
  }
}

function createSnapshotEnvelope(kind, data, options = {}) {
  return {
    schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
    kind,
    writtenAt: toIsoTimestamp(options.now),
    lastEventSequence: options.lastEventSequence || 0,
    data,
  };
}

function migrateLegacySnapshot(rawSnapshot, kind) {
  if (kind === REGISTRY_SNAPSHOT_KIND) {
    const rawRegistry =
      rawSnapshot?.data && !Array.isArray(rawSnapshot.data) ? rawSnapshot.data : rawSnapshot;
    return createSnapshotEnvelope(
      kind,
      {
        ...(rawRegistry || {}),
        projects: (rawRegistry?.projects || []).map((project) =>
          normalizeProjectRegistryEntry(project, { now: rawRegistry?.updatedAt }),
        ),
      },
      {
        now: rawRegistry?.updatedAt,
        lastEventSequence: rawSnapshot?.lastEventSequence || 0,
      },
    );
  }

  const rawCards = Array.isArray(rawSnapshot)
    ? rawSnapshot
    : Array.isArray(rawSnapshot?.cards)
      ? rawSnapshot.cards
      : Array.isArray(rawSnapshot?.data?.cards)
        ? rawSnapshot.data.cards
        : [];

  return createSnapshotEnvelope(
    kind,
    { cards: rawCards.map((card) => normalizeMasterCard(card, { now: rawSnapshot?.updatedAt })) },
    {
      now: rawSnapshot?.updatedAt,
      lastEventSequence: rawSnapshot?.lastEventSequence || 0,
    },
  );
}

function readSnapshot(filePath, kind) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const rawSnapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!rawSnapshot || typeof rawSnapshot !== "object") {
    throw new Error(`Mission Control snapshot ${filePath} is invalid JSON`);
  }

  if (rawSnapshot.schemaVersion === undefined) {
    return migrateLegacySnapshot(rawSnapshot, kind);
  }

  if (rawSnapshot.schemaVersion > MISSION_CONTROL_SCHEMA_VERSION) {
    throw new Error(
      `Mission Control snapshot ${filePath} uses unsupported schemaVersion ${rawSnapshot.schemaVersion}`,
    );
  }

  if (rawSnapshot.kind !== kind) {
    throw new Error(`Mission Control snapshot ${filePath} has unexpected kind ${rawSnapshot.kind}`);
  }

  if (kind === REGISTRY_SNAPSHOT_KIND) {
    return createSnapshotEnvelope(
      kind,
      {
        ...(rawSnapshot.data || {}),
        projects: (rawSnapshot.data?.projects || []).map((project) =>
          normalizeProjectRegistryEntry(project, { now: rawSnapshot.data?.updatedAt }),
        ),
      },
      {
        now: rawSnapshot.writtenAt,
        lastEventSequence: rawSnapshot.lastEventSequence || 0,
      },
    );
  }

  return createSnapshotEnvelope(
    kind,
    {
      cards: (rawSnapshot.data?.cards || []).map((card) =>
        normalizeMasterCard(card, { now: rawSnapshot.writtenAt }),
      ),
    },
    {
      now: rawSnapshot.writtenAt,
      lastEventSequence: rawSnapshot.lastEventSequence || 0,
    },
  );
}

function writeSnapshot(filePath, kind, data, options = {}) {
  const snapshot = createSnapshotEnvelope(kind, data, options);
  atomicWriteJson(filePath, snapshot);
  return snapshot;
}

function readEventLog(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, "utf8");
  if (!content.trim()) {
    return [];
  }

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const event = JSON.parse(line);

      if (event.schemaVersion > MISSION_CONTROL_SCHEMA_VERSION) {
        throw new Error(
          `Mission Control event log ${filePath} has unsupported schemaVersion ${event.schemaVersion} on line ${index + 1}`,
        );
      }

      return event;
    })
    .sort((left, right) => left.sequence - right.sequence);
}

function upsertCard(cards, nextCard) {
  const normalizedCard = normalizeMasterCard(nextCard, { now: nextCard.updatedAt });
  const withoutExisting = cards.filter((card) => card.id !== normalizedCard.id);

  return [...withoutExisting, normalizedCard].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

function applyEvent(state, event) {
  switch (event.type) {
    case "registry.saved":
      return {
        ...state,
        registry: event.payload.registry,
      };
    case "card.upserted":
      return {
        ...state,
        cards: upsertCard(state.cards, event.payload.card),
      };
    case "card.deleted":
      return {
        ...state,
        cards: state.cards.filter((card) => card.id !== event.payload.cardId),
      };
    default:
      return state;
  }
}

function replayMissionControlEvents(events, initialState = {}) {
  return (events || []).reduce((state, event) => applyEvent(state, event), {
    registry: initialState.registry || null,
    cards: initialState.cards || [],
  });
}

function appendEvent(filePath, event, options = {}) {
  const sequence = options.sequence || 1;
  const storedEvent = {
    schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
    kind: EVENT_LOG_KIND,
    sequence,
    occurredAt: toIsoTimestamp(event.occurredAt || options.now),
    type: event.type,
    payload: event.payload || {},
  };

  appendJsonLine(filePath, storedEvent);
  return storedEvent;
}

function createMissionControlStore(options = {}) {
  const paths = getMissionControlStorePaths(options.dataDir);
  ensureDirectory(paths.rootDir);

  const events = readEventLog(paths.eventLog);
  const registrySnapshot = readSnapshot(paths.registrySnapshot, REGISTRY_SNAPSHOT_KIND);
  const cardsSnapshot = readSnapshot(paths.cardsSnapshot, CARDS_SNAPSHOT_KIND);
  const latestSequence = events.reduce(
    (maxSequence, event) => Math.max(maxSequence, event.sequence || 0),
    0,
  );

  const registryState = replayMissionControlEvents(
    events.filter(
      (event) =>
        event.type === "registry.saved" &&
        event.sequence > (registrySnapshot?.lastEventSequence || 0),
    ),
    { registry: registrySnapshot?.data || null },
  );
  const cardsState = replayMissionControlEvents(
    events.filter(
      (event) =>
        ["card.upserted", "card.deleted"].includes(event.type) &&
        event.sequence > (cardsSnapshot?.lastEventSequence || 0),
    ),
    { cards: cardsSnapshot?.data?.cards || [] },
  );

  let state = {
    registry: registryState.registry,
    cards: cardsState.cards,
    sequence: latestSequence,
  };

  function saveRegistry(registry, saveOptions = {}) {
    const normalizedRegistry = {
      ...(registry || {}),
      projectCount: registry?.projects?.length || 0,
      updatedAt: toIsoTimestamp(saveOptions.now),
    };
    const event = appendEvent(
      paths.eventLog,
      {
        type: "registry.saved",
        payload: { registry: normalizedRegistry },
        occurredAt: saveOptions.now,
      },
      { sequence: state.sequence + 1, now: saveOptions.now },
    );

    writeSnapshot(paths.registrySnapshot, REGISTRY_SNAPSHOT_KIND, normalizedRegistry, {
      now: saveOptions.now,
      lastEventSequence: event.sequence,
    });

    state = {
      ...state,
      registry: normalizedRegistry,
      sequence: event.sequence,
    };

    return state.registry;
  }

  function writeCardsSnapshot(cards, saveOptions = {}) {
    writeSnapshot(
      paths.cardsSnapshot,
      CARDS_SNAPSHOT_KIND,
      { cards: cards.map((card) => normalizeMasterCard(card, { now: saveOptions.now })) },
      {
        now: saveOptions.now,
        lastEventSequence: state.sequence,
      },
    );
  }

  function upsertMasterCard(card, saveOptions = {}) {
    const normalizedCard = normalizeMasterCard(card, { now: saveOptions.now });
    const event = appendEvent(
      paths.eventLog,
      {
        type: "card.upserted",
        payload: { card: normalizedCard },
        occurredAt: saveOptions.now,
      },
      { sequence: state.sequence + 1, now: saveOptions.now },
    );

    const cards = upsertCard(state.cards, normalizedCard);
    state = {
      ...state,
      cards,
      sequence: event.sequence,
    };

    writeCardsSnapshot(cards, saveOptions);
    return normalizedCard;
  }

  function deleteMasterCard(cardId, saveOptions = {}) {
    const normalizedCardId = String(cardId);
    const event = appendEvent(
      paths.eventLog,
      {
        type: "card.deleted",
        payload: { cardId: normalizedCardId },
        occurredAt: saveOptions.now,
      },
      { sequence: state.sequence + 1, now: saveOptions.now },
    );

    const cards = state.cards.filter((card) => card.id !== normalizedCardId);
    state = {
      ...state,
      cards,
      sequence: event.sequence,
    };

    writeCardsSnapshot(cards, saveOptions);
    return cards;
  }

  if (
    options.registry &&
    stableStringify(options.registry) !== stableStringify(state.registry || {})
  ) {
    saveRegistry(options.registry, { now: options.now });
  } else if (!state.registry && options.registry) {
    saveRegistry(options.registry, { now: options.now });
  }

  if (!cardsSnapshot) {
    writeCardsSnapshot(state.cards, { now: options.now });
  }

  function appendStoreEvent(event, appendOptions = {}) {
    const storedEvent = appendEvent(paths.eventLog, event, {
      sequence: state.sequence + 1,
      now: appendOptions.now,
    });

    state = {
      ...applyEvent(state, storedEvent),
      sequence: storedEvent.sequence,
    };

    if (["card.upserted", "card.deleted"].includes(storedEvent.type)) {
      writeCardsSnapshot(state.cards, appendOptions);
    }

    if (storedEvent.type === "registry.saved") {
      writeSnapshot(paths.registrySnapshot, REGISTRY_SNAPSHOT_KIND, state.registry, {
        now: appendOptions.now,
        lastEventSequence: storedEvent.sequence,
      });
    }

    return storedEvent;
  }

  return {
    paths,
    appendEvent: appendStoreEvent,
    deleteMasterCard,
    getCards: () => [...state.cards],
    getRegistry: () => state.registry,
    getState: () => ({
      registry: state.registry,
      cards: [...state.cards],
      sequence: state.sequence,
    }),
    readEventLog: () => readEventLog(paths.eventLog),
    replayFromEventLog: () => replayMissionControlEvents(readEventLog(paths.eventLog)),
    upsertMasterCard,
  };
}

module.exports = {
  CARDS_SNAPSHOT_KIND,
  EVENT_LOG_KIND,
  REGISTRY_SNAPSHOT_KIND,
  appendEvent,
  atomicWriteJson,
  createMissionControlStore,
  createSnapshotEnvelope,
  getMissionControlStorePaths,
  readEventLog,
  readSnapshot,
  replayMissionControlEvents,
  stableStringify,
  writeSnapshot,
};
