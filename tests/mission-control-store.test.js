const { describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createMasterCardFromLinearIssue,
  normalizeDispatch,
  normalizeRisk,
} = require("../src/mission-control/models");
const { loadMissionControlRegistry } = require("../src/mission-control/registry");
const {
  CARDS_SNAPSHOT_FILENAME,
  EVENT_LOG_FILENAME,
  REGISTRY_SNAPSHOT_FILENAME,
  SYNC_STATE_FILENAME,
  createMissionControlStore,
  readJsonlEvents,
} = require("../src/mission-control/store");

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mission-control-"));
}

function createRegistry() {
  return loadMissionControlRegistry({
    missionControl: {
      projects: [
        {
          key: "mission-control",
          repoPath: "~/dev/arcqdev/openclaw-command-center",
          linearProjectSlug: "mission-control",
          lane: "lane:jon",
          symphonyPort: 45123,
        },
      ],
    },
  });
}

function createIssue(overrides = {}) {
  return {
    id: overrides.id || "issue-1",
    identifier: overrides.identifier || "ARC-23",
    title: overrides.title || "Build Mission Control foundation",
    description: overrides.description || "Implement durable Mission Control storage.",
    url: overrides.url || "https://linear.app/arcqdev/issue/ARC-23",
    priority: overrides.priority ?? 1,
    estimate: overrides.estimate ?? 3,
    createdAt: overrides.createdAt || "2026-03-10T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-03-10T00:05:00.000Z",
    startedAt: overrides.startedAt || null,
    completedAt: overrides.completedAt || null,
    canceledAt: overrides.canceledAt || null,
    archivedAt: overrides.archivedAt || null,
    state: overrides.state || {
      id: "state-todo",
      name: "Todo",
      type: "unstarted",
      color: "#999999",
    },
    project: overrides.project || {
      id: "project-1",
      name: "Mission Control",
      slug: "mission-control",
      progress: 0,
    },
    team: overrides.team || {
      id: "team-1",
      key: "ARC",
      name: "ArcQ Dev",
    },
    assignee: overrides.assignee || {
      id: "user-1",
      name: "Jon",
      email: "jon@example.com",
    },
    labels: overrides.labels || [],
    cycle: overrides.cycle || null,
  };
}

describe("Mission Control registry and models", () => {
  it("loads the canonical project registry model", () => {
    const registry = loadMissionControlRegistry();

    assert.strictEqual(registry.schemaVersion, 1);
    assert.ok(registry.projects.length >= 4);
    assert.ok(registry.projects.find((project) => project.key === "littlebrief"));
    assert.ok(registry.projects.find((project) => project.linearProjectSlug === "3237d374634d"));
  });

  it("derives normalized risk, dispatch, and status from Linear issues", () => {
    const registry = createRegistry();
    const project = registry.projects[0];
    const card = createMasterCardFromLinearIssue(
      {
        issue: createIssue({
          labels: [
            { id: "label-1", name: "dispatch:blocked", color: "#ff0000" },
            { id: "label-2", name: "risk:high", color: "#ffaa00" },
          ],
        }),
        project,
      },
      { now: "2026-03-10T00:00:00.000Z" },
    );

    assert.strictEqual(card.risk, normalizeRisk("risk:high"));
    assert.strictEqual(card.dispatch, normalizeDispatch("dispatch:blocked"));
    assert.strictEqual(card.status, "awaiting_review");
    assert.deepStrictEqual(card.repoTargets, [path.normalize(path.join(os.homedir(), "dev/arcqdev/openclaw-command-center"))]);
    assert.deepStrictEqual(card.symphonyTargets, [
      {
        projectKey: "mission-control",
        port: 45123,
        probeState: "unknown",
      },
    ]);
  });
});

describe("Mission Control durable store", () => {
  it("writes atomic snapshots and replays the append-only event log after restart", () => {
    const dataDir = createTempDir();
    const registry = createRegistry();
    const project = registry.projects[0];
    let currentTime = Date.parse("2026-03-10T00:00:00.000Z");
    const now = () => currentTime;

    const store = createMissionControlStore({
      dataDir,
      registry,
      syncDefaults: {
        pollIntervalMs: 120000,
        projectSlugs: ["mission-control"],
        webhook: { enabled: true, path: "/api/integrations/linear/webhook" },
      },
      now,
    });

    store.bootstrap();
    const initialCard = createMasterCardFromLinearIssue(
      {
        issue: createIssue({
          labels: [
            { id: "b", name: "dispatch:ready", color: "#00ff99" },
            { id: "a", name: "risk:high", color: "#ffaa00" },
          ],
        }),
        project,
      },
      { now: "2026-03-10T00:00:00.000Z" },
    );
    const noopCard = createMasterCardFromLinearIssue(
      {
        issue: createIssue({
          labels: [
            { id: "a", name: "risk:high", color: "#ffaa00" },
            { id: "b", name: "dispatch:ready", color: "#00ff99" },
          ],
        }),
        project,
      },
      { now: "2026-03-10T00:00:00.000Z" },
    );

    const first = store.upsertCard(initialCard, {
      source: "poller",
      receivedAt: "2026-03-10T00:01:00.000Z",
    });
    const second = store.upsertCard(noopCard, {
      source: "poller",
      receivedAt: "2026-03-10T00:02:00.000Z",
    });
    store.noteWebhookDelivery({
      deliveryId: "delivery-1",
      receivedAt: "2026-03-10T00:03:00.000Z",
    });
    store.updateSync({
      status: "ok",
      lastSuccessfulAt: "2026-03-10T00:04:00.000Z",
      cursor: { updatedAfter: "2026-03-10T00:04:00.000Z" },
    });

    assert.strictEqual(first.changed, true);
    assert.strictEqual(second.changed, false);

    const storeDir = path.join(dataDir, "mission-control");
    assert.ok(fs.existsSync(path.join(storeDir, REGISTRY_SNAPSHOT_FILENAME)));
    assert.ok(fs.existsSync(path.join(storeDir, CARDS_SNAPSHOT_FILENAME)));
    assert.ok(fs.existsSync(path.join(storeDir, SYNC_STATE_FILENAME)));
    assert.ok(fs.existsSync(path.join(storeDir, EVENT_LOG_FILENAME)));
    assert.deepStrictEqual(
      fs.readdirSync(storeDir).filter((name) => name.endsWith(".tmp")),
      [],
    );

    const events = readJsonlEvents(path.join(storeDir, EVENT_LOG_FILENAME));
    assert.ok(events.some((event) => event.kind === "mission-control.card-upserted"));
    assert.ok(events.some((event) => event.kind === "mission-control.sync-updated"));

    fs.writeFileSync(
      path.join(storeDir, CARDS_SNAPSHOT_FILENAME),
      JSON.stringify(
        {
          kind: "mission-control.cards.snapshot",
          version: 1,
          updatedAt: "2026-03-10T00:05:00.000Z",
          eventCount: 0,
          cards: {},
        },
        null,
        2,
      ),
    );

    currentTime = Date.parse("2026-03-10T00:06:00.000Z");
    const restarted = createMissionControlStore({
      dataDir,
      registry,
      syncDefaults: {
        pollIntervalMs: 120000,
        projectSlugs: ["mission-control"],
        webhook: { enabled: true, path: "/api/integrations/linear/webhook" },
      },
      now,
    });
    const state = restarted.getPublicState();

    assert.strictEqual(state.masterCards.length, 1);
    assert.strictEqual(state.stats.eventCount, 1);
    assert.strictEqual(state.sync.webhook.lastDeliveryId, "delivery-1");
    assert.strictEqual(state.sync.status, "ok");
    assert.strictEqual(state.sync.cursor.updatedAfter, "2026-03-10T00:04:00.000Z");
  });

  it("surfaces version guardrails for incompatible snapshots", () => {
    const dataDir = createTempDir();
    const registry = createRegistry();
    const storeDir = path.join(dataDir, "mission-control");
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(
      path.join(storeDir, CARDS_SNAPSHOT_FILENAME),
      JSON.stringify(
        {
          kind: "mission-control.cards.snapshot",
          version: 99,
          updatedAt: "2026-03-10T00:00:00.000Z",
          eventCount: 0,
          cards: {},
        },
        null,
        2,
      ),
    );

    const store = createMissionControlStore({
      dataDir,
      registry,
      syncDefaults: {
        pollIntervalMs: 120000,
        projectSlugs: ["mission-control"],
        webhook: { enabled: false, path: null },
      },
      now: () => Date.parse("2026-03-10T00:00:00.000Z"),
    });
    const state = store.getPublicState();

    assert.strictEqual(state.sync.status, "error");
    assert.match(state.sync.lastError, /unsupported version 99/);
  });
});
