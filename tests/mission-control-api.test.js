const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildAdminStatusPayload,
  buildBoardPayload,
  buildFiltersPayload,
  buildHealthPayload,
  buildMissionControlEventPayload,
  buildSyncPayload,
} = require("../src/mission-control/api");

function createState() {
  return {
    updatedAt: "2026-03-10T00:05:00.000Z",
    masterCards: [
      {
        id: "issue-1",
        identifier: "ARC-26",
        title: "Expose Mission Control API",
        updatedAt: "2026-03-10T00:04:00.000Z",
        priority: 1,
        estimate: 3,
        state: { name: "In Progress", type: "started", color: "#ffcc00" },
        project: { id: "project-1", name: "Mission Control", slug: "mission-control" },
        lane: "lane:jon",
        projectKey: "mission-control",
        healthStrip: {
          status: "ok",
          degraded: false,
          blocked: false,
          stale: false,
          risk: "low",
        },
        team: { id: "team-1", key: "ARC", name: "ArcQ Dev" },
        assignee: { id: "user-1", name: "Kerrigan", email: "queen@example.com" },
        labels: [{ id: "label-1", name: "api", color: "#ff00ff" }],
        cycle: { id: "cycle-1", number: 12, name: "Cycle 12" },
      },
      {
        id: "issue-2",
        identifier: "ARC-27",
        title: "Add SSE delta stream",
        updatedAt: "2026-03-10T00:03:00.000Z",
        priority: 2,
        estimate: null,
        state: { name: "Todo", type: "unstarted", color: "#999999" },
        project: { id: "project-1", name: "Mission Control", slug: "mission-control" },
        lane: "lane:jon",
        projectKey: "mission-control",
        healthStrip: {
          status: "degraded",
          degraded: true,
          blocked: true,
          stale: true,
          risk: "high",
        },
        team: { id: "team-1", key: "ARC", name: "ArcQ Dev" },
        assignee: null,
        labels: [{ id: "label-2", name: "sse", color: "#00ccff" }],
        cycle: null,
      },
    ],
    projects: [
      {
        key: "mission-control",
        lane: "lane:jon",
        cardCount: 2,
        symphony: {
          endpoint: "http://127.0.0.1:45123/health",
          status: "unreachable",
          queue: { active: 0, pending: 2, depth: 2 },
        },
        healthStrip: {
          status: "degraded",
          degraded: true,
          risk: "high",
          staleCardCount: 1,
          blockedCardCount: 1,
          highRiskCardCount: 1,
        },
      },
    ],
    lanes: [
      {
        lane: "lane:jon",
        cardCount: 2,
        projectCount: 1,
        staleCardCount: 1,
        highRiskCardCount: 1,
        degradedProjectCount: 1,
        status: "degraded",
      },
    ],
    runtime: {
      provider: "symphony",
      updatedAt: "2026-03-10T00:05:00.000Z",
      projectCount: 1,
      degradedProjectCount: 1,
    },
    stats: {
      totalCards: 2,
      eventCount: 4,
      staleCards: 1,
      highRiskCards: 1,
      projectCount: 1,
      laneCount: 1,
    },
    sync: {
      status: "ok",
      mode: "hybrid",
      pollIntervalMs: 120000,
      projectSlugs: ["mission-control"],
      cursor: { updatedAfter: "2026-03-10T00:04:00.000Z" },
      lastAttemptedAt: "2026-03-10T00:05:00.000Z",
      lastSuccessfulAt: "2026-03-10T00:05:00.000Z",
      lastWebhookAt: "2026-03-10T00:04:30.000Z",
      lastError: null,
      lastReason: "poll",
      lastFetchedCount: 2,
      lastChangedCount: 1,
      lagMs: 45000,
      webhook: {
        enabled: true,
        path: "/api/integrations/linear/webhook",
        lastDeliveryId: "delivery-1",
        recentDeliveryIds: ["delivery-1"],
      },
    },
  };
}

describe("Mission Control API payload builders", () => {
  it("builds board payload with stable stats", () => {
    const payload = buildBoardPayload(createState(), () => Date.parse("2026-03-10T00:06:00.000Z"));

    assert.strictEqual(payload.version, 1);
    assert.strictEqual(payload.masterCards.length, 2);
    assert.strictEqual(payload.projects.length, 1);
    assert.strictEqual(payload.stats.totalCards, 2);
    assert.strictEqual(payload.stats.projectCount, 1);
    assert.strictEqual(payload.sync.status, "ok");
  });

  it("builds filter metadata for projects, states, assignees, and labels", () => {
    const payload = buildFiltersPayload(createState());

    assert.strictEqual(payload.totalCards, 2);
    assert.deepStrictEqual(
      payload.filters.projects.map((item) => item.slug),
      ["mission-control"],
    );
    assert.deepStrictEqual(
      payload.filters.states.map((item) => item.label),
      ["In Progress", "Todo"],
    );
    assert.strictEqual(payload.filters.assignees[0].email, "queen@example.com");
    assert.deepStrictEqual(
      payload.filters.lanes.map((item) => item.label),
      ["lane:jon"],
    );
    assert.deepStrictEqual(
      payload.filters.labels.map((item) => item.label),
      ["api", "sse"],
    );
  });

  it("surfaces degraded Symphony runtime in health payload", () => {
    const payload = buildHealthPayload(createState());

    assert.strictEqual(payload.health.status, "degraded");
    assert.strictEqual(payload.health.runtime.degradedProjectCount, 1);
    assert.strictEqual(payload.health.runtime.projects[0].lane, "lane:jon");
    assert.strictEqual(payload.health.runtime.projects[0].status, "degraded");
  });

  it("marks health as stale when lag breaches threshold", () => {
    const payload = buildHealthPayload({
      ...createState(),
      projects: [
        {
          ...createState().projects[0],
          healthStrip: {
            ...createState().projects[0].healthStrip,
            status: "ok",
            degraded: false,
          },
          symphony: {
            ...createState().projects[0].symphony,
            status: "healthy",
          },
        },
      ],
      runtime: {
        ...createState().runtime,
        degradedProjectCount: 0,
      },
      sync: {
        ...createState().sync,
        lagMs: 400000,
      },
    });

    assert.strictEqual(payload.health.status, "stale");
    assert.ok(payload.health.summary.includes("stale threshold"));
  });

  it("includes lag and SSE metadata in sync/admin payloads", () => {
    const syncPayload = buildSyncPayload(createState());
    const adminPayload = buildAdminStatusPayload(createState(), {
      sseClientCount: 3,
      lastReplayAt: "2026-03-10T00:06:00.000Z",
      lastMissionControlEventAt: "2026-03-10T00:05:30.000Z",
    });

    assert.strictEqual(syncPayload.sync.lag.seconds, 45);
    assert.strictEqual(adminPayload.sse.clientCount, 3);
    assert.strictEqual(adminPayload.sse.lastReplayAt, "2026-03-10T00:06:00.000Z");
  });

  it("builds SSE delta payloads for card updates and replay", () => {
    const state = createState();
    const deltaPayload = buildMissionControlEventPayload(
      {
        type: "card-upserted",
        action: "updated",
        card: state.masterCards[0],
      },
      state,
    );
    const replayPayload = buildMissionControlEventPayload({ type: "replay" }, state);

    assert.strictEqual(deltaPayload.type, "card-upserted");
    assert.strictEqual(deltaPayload.delta.identifier, "ARC-26");
    assert.strictEqual(replayPayload.type, "replay");
    assert.strictEqual(replayPayload.board.masterCards.length, 2);
  });

  it("emits runtime delta payloads for operator health strips", () => {
    const runtimePayload = buildMissionControlEventPayload(
      { type: "runtime-updated" },
      createState(),
    );

    assert.strictEqual(runtimePayload.type, "runtime-updated");
    assert.strictEqual(runtimePayload.delta.projects[0].lane, "lane:jon");
    assert.strictEqual(runtimePayload.delta.projects[0].status, "degraded");
  });
});
