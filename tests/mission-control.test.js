const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createMasterCardFromLinearIssue,
  deriveCardStatus,
} = require("../src/mission-control/models");
const { initializeMissionControl } = require("../src/mission-control");
const { loadMissionControlRegistry } = require("../src/mission-control/registry");
const {
  appendEvent,
  atomicWriteJson,
  createMissionControlStore,
  getMissionControlStorePaths,
  readSnapshot,
  replayMissionControlEvents,
} = require("../src/mission-control/store");

const tempDirs = [];

function createTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mission-control-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig() {
  return {
    missionControl: {
      projects: [
        {
          key: "littlebrief",
          repoPath: "~/dev/arcqdev/littlebrief",
          linearProjectSlug: "littlebrief",
          lane: "lane:jon",
          symphonyPort: 45123,
        },
      ],
    },
  };
}

function createCard(overrides = {}) {
  return createMasterCardFromLinearIssue(
    {
      issue: {
        id: "lin_123",
        identifier: "LB-123",
        title: "Build Mission Control storage",
        description: "Implement the append-only event log and snapshot store.",
        state: { type: "started", name: "In Progress" },
        labels: [
          { name: "lane:jon" },
          { name: "risk:high" },
          { name: "dispatch:blocked" },
          { name: "external-facing" },
        ],
      },
      project: loadMissionControlRegistry(createConfig(), { now: "2026-03-09T20:00:00.000Z" })
        .projects[0],
    },
    { now: "2026-03-09T20:05:00.000Z" },
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("mission control registry + models", () => {
  it("loads a canonical project registry with default agents", () => {
    const registry = loadMissionControlRegistry(createConfig(), {
      now: "2026-03-09T20:00:00.000Z",
    });

    assert.strictEqual(registry.schemaVersion, 1);
    assert.strictEqual(registry.projectCount, 1);
    assert.deepStrictEqual(registry.projects[0], {
      key: "littlebrief",
      repoPath: "~/dev/arcqdev/littlebrief",
      linearProjectSlug: "littlebrief",
      lane: "lane:jon",
      symphonyPort: 45123,
      createdAt: "2026-03-09T20:00:00.000Z",
      updatedAt: "2026-03-09T20:00:00.000Z",
    });
    assert.deepStrictEqual(
      registry.agents.map((agent) => agent.key),
      ["jon", "mia", "pepper"],
    );
  });

  it("derives a master card from a Linear issue with normalized review state", () => {
    const card = createCard();

    assert.strictEqual(card.id, "mc:lin_123");
    assert.strictEqual(card.lane, "lane:jon");
    assert.strictEqual(card.risk, "risk:high");
    assert.strictEqual(card.dispatch, "dispatch:blocked");
    assert.strictEqual(card.status, "awaiting_review");
    assert.strictEqual(card.humanReviewRequired, true);
    assert.match(card.reviewReason, /risk:high/);
    assert.match(card.reviewReason, /external-facing/);
    assert.deepStrictEqual(card.originProjects, ["littlebrief"]);
    assert.deepStrictEqual(card.repoTargets, ["~/dev/arcqdev/littlebrief"]);
    assert.deepStrictEqual(card.symphonyTargets, [
      {
        projectKey: "littlebrief",
        port: 45123,
        probeState: "unknown",
      },
    ]);
  });

  it("applies card status precedence deterministically", () => {
    const status = deriveCardStatus({
      issueLifecycles: ["done", "canceled"],
      humanReviewRequired: true,
      dependencies: [
        { kind: "external", id: "x", label: "review", status: "open", blocking: true },
      ],
      dispatch: "dispatch:blocked",
    });

    assert.strictEqual(status, "completed");
  });

  it("fails bootstrap safely when registry config is invalid", () => {
    const result = initializeMissionControl({
      dataDir: createTempDataDir(),
      config: {
        missionControl: {
          projects: [{ key: "broken", linearProjectSlug: "broken", lane: "lane:jon" }],
        },
      },
      logger: { log() {}, error() {} },
      now: "2026-03-09T20:00:00.000Z",
    });

    assert.strictEqual(result.ready, false);
    assert.match(result.error.message, /missing repoPath/);
    assert.strictEqual(result.store, null);
  });
});

describe("mission control durable store", () => {
  it("writes atomic snapshots on initialization", () => {
    const dataDir = createTempDataDir();
    const registry = loadMissionControlRegistry(createConfig(), {
      now: "2026-03-09T20:00:00.000Z",
    });

    const store = createMissionControlStore({
      dataDir,
      registry,
      now: "2026-03-09T20:00:00.000Z",
    });
    const paths = getMissionControlStorePaths(dataDir);

    assert.ok(fs.existsSync(paths.registrySnapshot));
    assert.ok(fs.existsSync(paths.cardsSnapshot));
    assert.ok(fs.existsSync(paths.eventLog));
    assert.strictEqual(store.getState().sequence, 1);
    assert.deepStrictEqual(
      fs.readdirSync(paths.rootDir).filter((file) => file.endsWith(".tmp")),
      [],
    );
  });

  it("atomically overwrites an existing snapshot file", () => {
    const dataDir = createTempDataDir();
    const paths = getMissionControlStorePaths(dataDir);
    fs.mkdirSync(paths.rootDir, { recursive: true });

    atomicWriteJson(paths.registrySnapshot, { version: 1, cards: ["older"] });
    atomicWriteJson(paths.registrySnapshot, { version: 2, cards: ["newer"] });

    const saved = JSON.parse(fs.readFileSync(paths.registrySnapshot, "utf8"));
    assert.deepStrictEqual(saved, { version: 2, cards: ["newer"] });
    assert.deepStrictEqual(
      fs.readdirSync(paths.rootDir).filter((file) => file.endsWith(".tmp")),
      [],
    );
  });

  it("replays post-snapshot events after restart", () => {
    const dataDir = createTempDataDir();
    const registry = loadMissionControlRegistry(createConfig(), {
      now: "2026-03-09T20:00:00.000Z",
    });
    const store = createMissionControlStore({
      dataDir,
      registry,
      now: "2026-03-09T20:00:00.000Z",
    });

    const firstCard = createCard();
    store.upsertMasterCard(firstCard, { now: "2026-03-09T20:10:00.000Z" });

    const secondCard = {
      ...createCard({}),
      id: "mc:lin_456",
      primaryLinearIssueId: "lin_456",
      primaryLinearIdentifier: "LB-456",
      linkedLinearIssueIds: ["lin_456"],
      linkedLinearIdentifiers: ["LB-456"],
      title: "Recover from event-only writes",
      updatedAt: "2026-03-09T20:11:00.000Z",
    };

    appendEvent(
      getMissionControlStorePaths(dataDir).eventLog,
      {
        type: "card.upserted",
        payload: { card: secondCard },
        occurredAt: "2026-03-09T20:11:00.000Z",
      },
      { sequence: 3, now: "2026-03-09T20:11:00.000Z" },
    );

    const reloadedStore = createMissionControlStore({ dataDir });

    assert.deepStrictEqual(
      reloadedStore.getCards().map((card) => card.id),
      ["mc:lin_123", "mc:lin_456"],
    );
    assert.strictEqual(reloadedStore.getState().sequence, 3);
  });

  it("advances sequence and state when appendEvent is used directly", () => {
    const dataDir = createTempDataDir();
    const registry = loadMissionControlRegistry(createConfig(), {
      now: "2026-03-09T20:00:00.000Z",
    });
    const store = createMissionControlStore({
      dataDir,
      registry,
      now: "2026-03-09T20:00:00.000Z",
    });

    const firstCard = createCard();
    const secondCard = {
      ...createCard({}),
      id: "mc:lin_456",
      primaryLinearIssueId: "lin_456",
      primaryLinearIdentifier: "LB-456",
      linkedLinearIssueIds: ["lin_456"],
      linkedLinearIdentifiers: ["LB-456"],
      title: "Direct append path",
      updatedAt: "2026-03-09T20:11:00.000Z",
    };

    const firstEvent = store.appendEvent(
      {
        type: "card.upserted",
        payload: { card: firstCard },
        occurredAt: "2026-03-09T20:10:00.000Z",
      },
      { now: "2026-03-09T20:10:00.000Z" },
    );
    const secondEvent = store.appendEvent(
      {
        type: "card.upserted",
        payload: { card: secondCard },
        occurredAt: "2026-03-09T20:11:00.000Z",
      },
      { now: "2026-03-09T20:11:00.000Z" },
    );

    assert.strictEqual(firstEvent.sequence, 2);
    assert.strictEqual(secondEvent.sequence, 3);
    assert.deepStrictEqual(
      store.getCards().map((card) => card.id),
      ["mc:lin_123", "mc:lin_456"],
    );

    const reloadedStore = createMissionControlStore({ dataDir });
    assert.deepStrictEqual(
      reloadedStore.getCards().map((card) => card.id),
      ["mc:lin_123", "mc:lin_456"],
    );
  });

  it("replays the event log into the final card state", () => {
    const dataDir = createTempDataDir();
    const registry = loadMissionControlRegistry(createConfig(), {
      now: "2026-03-09T20:00:00.000Z",
    });
    const store = createMissionControlStore({
      dataDir,
      registry,
      now: "2026-03-09T20:00:00.000Z",
    });

    const card = createCard();
    store.upsertMasterCard(card, { now: "2026-03-09T20:10:00.000Z" });
    store.deleteMasterCard(card.id, { now: "2026-03-09T20:15:00.000Z" });

    const replayed = replayMissionControlEvents(store.readEventLog());

    assert.strictEqual(replayed.registry.projectCount, 1);
    assert.deepStrictEqual(replayed.cards, []);
  });

  it("migrates a legacy cards snapshot without schemaVersion", () => {
    const dataDir = createTempDataDir();
    const paths = getMissionControlStorePaths(dataDir);
    fs.mkdirSync(paths.rootDir, { recursive: true });
    fs.writeFileSync(paths.cardsSnapshot, JSON.stringify([createCard()], null, 2));

    const snapshot = readSnapshot(paths.cardsSnapshot, "mission-control.cards.snapshot");

    assert.strictEqual(snapshot.schemaVersion, 1);
    assert.strictEqual(snapshot.data.cards.length, 1);
    assert.strictEqual(snapshot.data.cards[0].id, "mc:lin_123");
  });

  it("rejects future-version snapshots", () => {
    const dataDir = createTempDataDir();
    const paths = getMissionControlStorePaths(dataDir);
    fs.mkdirSync(paths.rootDir, { recursive: true });
    fs.writeFileSync(
      paths.cardsSnapshot,
      JSON.stringify(
        {
          schemaVersion: 999,
          kind: "mission-control.cards.snapshot",
          writtenAt: "2026-03-09T20:00:00.000Z",
          lastEventSequence: 0,
          data: { cards: [] },
        },
        null,
        2,
      ),
    );

    assert.throws(
      () => readSnapshot(paths.cardsSnapshot, "mission-control.cards.snapshot"),
      /unsupported schemaVersion 999/,
    );
  });
});
