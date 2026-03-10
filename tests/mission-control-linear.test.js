const { describe, it } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLinearSyncStore } = require("../src/mission-control/linear/store");
const { createLinearSyncEngine } = require("../src/mission-control/linear/sync-engine");

function createIssue(overrides = {}) {
  return {
    id: "issue-1",
    identifier: "ARC-32",
    title: "Implement Linear sync engine",
    description: "Hybrid sync",
    url: "https://linear.app/arcqdev/issue/ARC-32",
    priority: 2,
    estimate: 3,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    state: {
      id: "state-todo",
      name: "Todo",
      type: "unstarted",
      color: "#999999",
    },
    project: {
      id: "project-1",
      name: "Mission Control",
      slug: "mission-control",
      progress: 20,
    },
    team: {
      id: "team-1",
      key: "ARC",
      name: "ArcQ Dev",
    },
    assignee: {
      id: "user-1",
      name: "Kerrigan",
      email: "queen@example.com",
    },
    labels: [{ id: "label-1", name: "sync", color: "#ff00ff" }],
    cycle: null,
    ...overrides,
  };
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-linear-"));
}

function signPayload(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

describe("Mission Control Linear store", () => {
  it("performs idempotent upserts without duplicating events", () => {
    const dataDir = createTempDir();
    const now = () => Date.parse("2026-03-10T00:00:00.000Z");
    const store = createLinearSyncStore({
      dataDir,
      now,
      pollIntervalMs: 120000,
      projectSlugs: ["mission-control"],
      webhook: { enabled: true, path: "/api/integrations/linear/webhook" },
    });

    const first = store.upsertCard(createIssue(), {
      source: "poller",
      receivedAt: "2026-03-10T00:00:00.000Z",
    });
    const second = store.upsertCard(createIssue(), {
      source: "poller",
      receivedAt: "2026-03-10T00:00:00.000Z",
    });

    assert.strictEqual(first.changed, true);
    assert.strictEqual(first.action, "created");
    assert.strictEqual(second.changed, false);
    assert.strictEqual(second.action, "noop");

    const state = store.getPublicState();
    assert.strictEqual(state.stats.totalCards, 1);
    assert.strictEqual(state.stats.eventCount, 1);
  });
});

describe("Mission Control Linear sync engine", () => {
  it("deduplicates duplicate webhook deliveries while keeping one card", async () => {
    const dataDir = createTempDir();
    const currentTime = Date.parse("2026-03-10T00:00:00.000Z");
    const now = () => currentTime;
    const secret = "zerg-rush";
    const issue = createIssue();
    const payload = JSON.stringify({
      action: "update",
      webhookTimestamp: new Date(currentTime).toISOString(),
      data: issue,
    });

    const engine = createLinearSyncEngine({
      config: {
        enabled: true,
        apiKey: "linear-key",
        projectSlugs: ["mission-control"],
        syncIntervalMs: 120000,
        reconcileOverlapMs: 300000,
        webhookPath: "/api/integrations/linear/webhook",
        webhookSecret: secret,
      },
      dataDir,
      now,
      client: {
        fetchIssuesForProjects: async () => [issue],
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: (fn) => {
        fn();
        return 1;
      },
      clearTimeoutFn: () => {},
    });

    const headers = {
      "linear-signature": signPayload(secret, payload),
      "linear-delivery": "delivery-1",
    };

    const first = await engine.handleWebhook({ headers, rawBody: payload });
    const second = await engine.handleWebhook({ headers, rawBody: payload });
    const state = engine.getPublicState();

    assert.strictEqual(first.statusCode, 202);
    assert.strictEqual(first.body.changed, true);
    assert.strictEqual(second.statusCode, 200);
    assert.strictEqual(second.body.duplicate, true);
    assert.strictEqual(state.stats.totalCards, 1);
    assert.strictEqual(state.stats.eventCount, 1);
  });

  it("reconciles from persisted snapshot after downtime", async () => {
    const dataDir = createTempDir();
    let currentTime = Date.parse("2026-03-10T00:00:00.000Z");
    const now = () => currentTime;

    const initialIssue = createIssue();
    const updatedIssue = createIssue({
      updatedAt: "2026-03-10T00:08:00.000Z",
      state: {
        id: "state-done",
        name: "Done",
        type: "completed",
        color: "#00ff99",
      },
    });

    const baseConfig = {
      enabled: true,
      apiKey: "linear-key",
      projectSlugs: ["mission-control"],
      syncIntervalMs: 120000,
      reconcileOverlapMs: 300000,
      webhookPath: "/api/integrations/linear/webhook",
      webhookSecret: null,
    };

    const firstEngine = createLinearSyncEngine({
      config: baseConfig,
      dataDir,
      now,
      client: {
        fetchIssuesForProjects: async () => [initialIssue],
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await firstEngine.reconcile({ reason: "startup" });
    firstEngine.stop();

    currentTime = Date.parse("2026-03-10T00:10:00.000Z");
    const secondEngine = createLinearSyncEngine({
      config: baseConfig,
      dataDir,
      now,
      client: {
        fetchIssuesForProjects: async () => [updatedIssue],
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await secondEngine.reconcile({ reason: "poll" });
    const state = secondEngine.getPublicState();

    assert.strictEqual(state.masterCards[0].state.name, "Done");
    assert.strictEqual(state.stats.eventCount, 2);
    assert.strictEqual(state.sync.cursor.updatedAfter, "2026-03-10T00:08:00.000Z");
    assert.strictEqual(state.sync.status, "ok");
  });

  it("records sync errors without crashing reconcile callers", async () => {
    const dataDir = createTempDir();
    const now = () => Date.parse("2026-03-10T00:00:00.000Z");

    const engine = createLinearSyncEngine({
      config: {
        enabled: true,
        apiKey: "linear-key",
        projectSlugs: ["mission-control"],
        syncIntervalMs: 120000,
        reconcileOverlapMs: 300000,
        webhookPath: "/api/integrations/linear/webhook",
        webhookSecret: null,
      },
      dataDir,
      now,
      client: {
        fetchIssuesForProjects: async () => {
          throw new Error("Linear unavailable");
        },
      },
      logger: { error: () => {} },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    const state = await engine.reconcile({ reason: "poll" });

    assert.strictEqual(state.sync.status, "error");
    assert.strictEqual(state.sync.lastError, "Linear unavailable");
    assert.strictEqual(state.stats.totalCards, 0);
  });
});

it("emits store change notifications for webhook upserts", async () => {
  const dataDir = createTempDir();
  const currentTime = Date.parse("2026-03-10T00:00:00.000Z");
  const now = () => currentTime;
  const secret = "brood-war";
  const issue = createIssue();
  const payload = JSON.stringify({
    action: "update",
    webhookTimestamp: new Date(currentTime).toISOString(),
    data: issue,
  });
  const changes = [];

  const engine = createLinearSyncEngine({
    config: {
      enabled: false,
      apiKey: null,
      projectSlugs: ["mission-control"],
      syncIntervalMs: 120000,
      reconcileOverlapMs: 300000,
      webhookPath: "/api/integrations/linear/webhook",
      webhookSecret: secret,
    },
    dataDir,
    now,
    onStateChange: (change) => changes.push(change.type),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    setTimeoutFn: (fn) => {
      fn();
      return 1;
    },
    clearTimeoutFn: () => {},
  });

  const response = await engine.handleWebhook({
    headers: {
      "linear-signature": signPayload(secret, payload),
      "linear-delivery": "delivery-2",
    },
    rawBody: payload,
  });

  assert.strictEqual(response.statusCode, 202);
  assert.ok(changes.includes("webhook-delivery"));
  assert.ok(changes.includes("card-upserted"));
  assert.ok(changes.includes("sync-updated"));
});
