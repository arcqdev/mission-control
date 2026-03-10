const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createSymphonyHealthProvider } = require("../src/mission-control/health-provider");
const { buildMissionControlPublicState } = require("../src/mission-control");
const { loadMissionControlRegistry } = require("../src/mission-control/registry");

function createConfig(port = 45123) {
  return {
    missionControl: {
      projects: [
        {
          key: "mission-control",
          label: "Mission Control",
          repoPath: "~/dev/arcqdev/mission-control",
          linearProjectSlug: "mission-control",
          lane: "lane:jon",
          symphonyPort: port,
          symphonyHealthPath: "/health",
        },
      ],
    },
  };
}

function createLinearState(overrides = {}) {
  return {
    masterCards: [
      {
        id: "issue-1",
        identifier: "ARC-25",
        title: "Add runtime health",
        createdAt: "2026-03-09T18:00:00.000Z",
        updatedAt: "2026-03-09T18:00:00.000Z",
        state: { name: "Blocked", type: "blocked", color: "#f85149" },
        project: { slug: "mission-control", name: "Mission Control" },
        labels: [{ name: "blocker" }],
      },
    ],
    stats: {
      totalCards: 1,
      eventCount: 2,
    },
    sync: {
      status: "ok",
      mode: "hybrid",
      pollIntervalMs: 120000,
      projectSlugs: ["mission-control"],
      cursor: { updatedAfter: "2026-03-09T18:00:00.000Z" },
      lastAttemptedAt: "2026-03-09T18:05:00.000Z",
      lastSuccessfulAt: "2026-03-09T18:05:00.000Z",
      lastWebhookAt: null,
      lastError: null,
      lastReason: "poll",
      lastFetchedCount: 1,
      lastChangedCount: 1,
      lagMs: 1000,
      webhook: {
        enabled: false,
        path: null,
        lastDeliveryId: null,
        recentDeliveryIds: [],
      },
    },
    ...overrides,
  };
}

describe("Mission Control Symphony health provider", () => {
  let tempDir = null;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("reads registry endpoints and persists structured Symphony health", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-health-"));
    const registry = loadMissionControlRegistry(createConfig(45123));
    const provider = createSymphonyHealthProvider({
      registry,
      dataDir: tempDir,
      now: () => Date.parse("2026-03-09T19:00:00.000Z"),
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: "ok",
          queue: {
            active: 1,
            pending: 2,
            depth: 3,
          },
        }),
      }),
    });

    const state = await provider.refresh();
    const snapshotPath = path.join(tempDir, "mission-control", "symphony-health.json");

    assert.strictEqual(state.projects[0].projectKey, "mission-control");
    assert.strictEqual(state.projects[0].lane, "lane:jon");
    assert.strictEqual(state.projects[0].symphony.endpoint, "http://127.0.0.1:45123/health");
    assert.strictEqual(state.projects[0].symphony.status, "healthy");
    assert.deepStrictEqual(state.projects[0].symphony.queue, { active: 1, pending: 2, depth: 3 });
    assert.ok(fs.existsSync(snapshotPath));
  });

  it("derives stale-work and high-risk signals deterministically when Symphony is unreachable", () => {
    const registry = loadMissionControlRegistry(createConfig(45123));
    const runtimeState = {
      updatedAt: "2026-03-09T19:00:00.000Z",
      projects: [
        {
          projectKey: "mission-control",
          linearProjectSlug: "mission-control",
          lane: "lane:jon",
          symphony: {
            endpoint: "http://127.0.0.1:45123/health",
            status: "unreachable",
            reachable: false,
            summary: "Runtime unreachable: connect ECONNREFUSED",
            queue: { active: 0, pending: 0, depth: 0 },
          },
        },
      ],
    };

    const publicState = buildMissionControlPublicState({
      linearState: createLinearState(),
      registry,
      runtimeState,
      now: () => Date.parse("2026-03-10T06:30:00.000Z"),
    });

    assert.strictEqual(publicState.masterCards[0].lane, "lane:jon");
    assert.strictEqual(publicState.masterCards[0].healthStrip.stale, true);
    assert.strictEqual(publicState.masterCards[0].healthStrip.risk, "high");
    assert.strictEqual(publicState.masterCards[0].healthStrip.status, "degraded");
    assert.ok(publicState.masterCards[0].healthStrip.signals.includes("symphony-down"));
    assert.strictEqual(publicState.projects[0].healthStrip.status, "degraded");
    assert.strictEqual(publicState.projects[0].healthStrip.highRiskCardCount, 1);
    assert.strictEqual(publicState.lanes[0].lane, "lane:jon");
  });
});
