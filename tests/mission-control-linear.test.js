const { describe, it } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createLinearClient, normalizeIssue } = require("../src/mission-control/linear/client");
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
  it("performs idempotent upserts while recording audit observations", () => {
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
    assert.strictEqual(state.stats.eventCount, 2);

    const timeline = store.getTimelineForCard({ cardId: "mc:issue-1" });
    assert.strictEqual(timeline.length, 2);
  });
});

describe("Mission Control Linear client", () => {
  it("normalizes parent-child and related issue references", () => {
    const issue = normalizeIssue({
      id: "issue-parent",
      identifier: "ARC-70",
      title: "Parent issue",
      description: "",
      state: { id: "state-started", name: "In Progress", type: "started", color: "#58a6ff" },
      project: { id: "project-1", name: "Littlebrief", slug: "littlebrief", progress: 10 },
      team: { id: "team-1", key: "ARC", name: "ArcQ Dev" },
      assignee: null,
      labels: { nodes: [{ id: "lane-jon", name: "lane:jon", color: "#58a6ff" }] },
      cycle: null,
      parent: null,
      children: {
        nodes: [
          {
            id: "issue-child",
            identifier: "ARC-71",
            title: "Child issue",
            state: { id: "state-todo", name: "Todo", type: "unstarted", color: "#999999" },
            project: { id: "project-2", name: "Growth", slug: "growth-board", progress: 0 },
            labels: { nodes: [{ id: "lane-mia", name: "lane:mia", color: "#ff66aa" }] },
          },
        ],
      },
      relations: {
        nodes: [
          {
            id: "rel-1",
            type: "related",
            relatedIssue: {
              id: "issue-related",
              identifier: "ARC-72",
              title: "Related issue",
              state: { id: "state-todo", name: "Todo", type: "unstarted", color: "#999999" },
              project: { id: "project-3", name: "Pepper", slug: "pepper-board", progress: 0 },
              labels: { nodes: [{ id: "lane-pepper", name: "lane:pepper", color: "#d29922" }] },
            },
          },
        ],
      },
      inverseRelations: { nodes: [] },
    });

    assert.deepStrictEqual(issue.linkedIssueIds, ["issue-child", "issue-related"]);
    assert.deepStrictEqual(issue.linkedIssueIdentifiers, ["ARC-71", "ARC-72"]);
    assert.strictEqual(issue.linkedIssues[0].linkRole, "child");
    assert.strictEqual(issue.linkedIssues[1].relationType, "related");
  });

  it("creates issues and resolves label ids through the GraphQL transport", async () => {
    const calls = [];
    const client = createLinearClient({
      apiKey: "linear-key",
      transport: async ({ query, variables }) => {
        calls.push({ query, variables });

        if (query.includes("MissionControlResolveProject")) {
          return {
            projects: {
              nodes: [
                {
                  id: "project-growth",
                  name: "Growth",
                  slugId: "growth-board",
                  teams: {
                    nodes: [{ id: "team-growth", key: "ARC", name: "ArcQ Dev" }],
                  },
                },
              ],
            },
          };
        }

        if (query.includes("MissionControlResolveLabels")) {
          return {
            issueLabels: {
              nodes: [
                { id: "label-lane", name: "lane:mia" },
                { id: "label-risk", name: "risk:low" },
                { id: "label-dispatch", name: "dispatch:ready" },
              ],
            },
          };
        }

        if (query.includes("MissionControlCreateIssue")) {
          return {
            issueCreate: {
              success: true,
              issue: {
                id: "issue-created",
                identifier: "ARC-73",
                title: variables.input.title,
                description: variables.input.description,
                url: "https://linear.app/arcqdev/issue/ARC-73",
                priority: 0,
                estimate: null,
                createdAt: "2026-03-10T00:00:00.000Z",
                updatedAt: "2026-03-10T00:00:00.000Z",
                startedAt: null,
                completedAt: null,
                canceledAt: null,
                archivedAt: null,
                state: { id: "state-todo", name: "Todo", type: "unstarted", color: "#999999" },
                project: {
                  id: "project-growth",
                  name: "Growth",
                  slug: "growth-board",
                  progress: 0,
                },
                team: { id: "team-growth", key: "ARC", name: "ArcQ Dev" },
                assignee: null,
                labels: {
                  nodes: [
                    { id: "label-lane", name: "lane:mia", color: "#ff66aa" },
                    { id: "label-risk", name: "risk:low", color: "#58a6ff" },
                    { id: "label-dispatch", name: "dispatch:ready", color: "#3fb950" },
                  ],
                },
                cycle: null,
                parent: null,
                children: { nodes: [] },
                relations: { nodes: [] },
                inverseRelations: { nodes: [] },
              },
            },
          };
        }

        throw new Error("Unexpected GraphQL operation");
      },
    });

    const project = await client.resolveProjectBySlug("growth-board");
    const labelIds = await client.resolveLabelIdsForTeam({
      teamId: project.team.id,
      labelNames: ["lane:mia", "risk:low", "dispatch:ready"],
    });
    const createdIssue = await client.createIssue({
      title: "Create child",
      description: "Cross-lane work",
      teamId: project.team.id,
      projectId: project.id,
      labelIds,
    });

    assert.strictEqual(project.id, "project-growth");
    assert.deepStrictEqual(labelIds, ["label-lane", "label-risk", "label-dispatch"]);
    assert.strictEqual(createdIssue.identifier, "ARC-73");
    assert.strictEqual(calls.length, 3);
  });
});

describe("Mission Control Linear sync engine", () => {
  it("converges on fresh boot and schedules the 2-minute reconcile poller", async () => {
    const dataDir = createTempDir();
    const now = () => Date.parse("2026-03-10T00:00:00.000Z");
    let fetchCalls = 0;
    let scheduledIntervalMs = null;
    let pollTick = null;
    let resolveFetch;

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
          fetchCalls += 1;
          return new Promise((resolve) => {
            resolveFetch = () => resolve([createIssue()]);
          });
        },
      },
      setIntervalFn: (fn, ms) => {
        pollTick = fn;
        scheduledIntervalMs = ms;
        return 1;
      },
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    engine.start();

    assert.strictEqual(fetchCalls, 1);
    assert.strictEqual(scheduledIntervalMs, 120000);
    assert.strictEqual(typeof pollTick, "function");

    resolveFetch();
    await new Promise((resolve) => setImmediate(resolve));

    const state = engine.getPublicState();
    assert.strictEqual(state.stats.totalCards, 1);
    assert.strictEqual(state.masterCards[0].identifier, "ARC-32");
    assert.strictEqual(state.sync.status, "ok");
    assert.strictEqual(state.sync.lastReason, "startup");
    assert.strictEqual(state.sync.pollIntervalMs, 120000);
  });

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
    assert.ok(state.stats.eventCount >= 3);
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
    assert.ok(state.stats.eventCount >= 4);
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
});
