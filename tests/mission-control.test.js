const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createMissionControlService } = require("../src/mission-control");
const { createMissionControlViewsStore } = require("../src/mission-control/views");

const tempDirs = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mission-control-"));
  tempDirs.push(dir);
  return dir;
}

function createIssue(overrides = {}) {
  return {
    id: "issue-1",
    identifier: "ARC-38",
    title: "Operational hardening",
    description: "Replay audits and reconcile diagnostics",
    url: "https://linear.app/arcqdev/issue/ARC-38",
    priority: 2,
    estimate: 3,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T04:00:00.000Z",
    state: {
      id: "state-progress",
      name: "In Progress",
      type: "started",
      color: "#58a6ff",
    },
    project: {
      id: "project-1",
      name: "Littlebrief",
      slug: "littlebrief",
      progress: 40,
    },
    team: {
      id: "team-1",
      key: "ARC",
      name: "ArcQ Dev",
    },
    assignee: {
      id: "user-1",
      name: "Jon",
      email: "jon@example.com",
    },
    labels: [{ id: "label-1", name: "lane:jon", color: "#58a6ff" }],
    cycle: null,
    ...overrides,
  };
}

function createConfig(overrides = {}) {
  return {
    integrations: {
      linear: {
        enabled: true,
        apiKey: "linear-key",
        projectSlugs: ["littlebrief"],
        syncIntervalMs: 120000,
        reconcileOverlapMs: 300000,
        webhookPath: "/api/integrations/linear/webhook",
        webhookSecret: "secret",
        ...(overrides.integrations?.linear || {}),
      },
    },
    missionControl: {
      projects: [
        {
          key: "littlebrief",
          repoPath: "~/dev/arcqdev/littlebrief",
          linearProjectSlug: "littlebrief",
          lane: "lane:jon",
          symphonyPort: 45123,
        },
        ...((overrides.missionControl?.projects || []).slice(1) || []),
      ],
      outcomes: overrides.missionControl?.outcomes || [],
      discordDestinations: overrides.missionControl?.discordDestinations || [],
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("mission control saved views", () => {
  it("persists the active saved view across restart", () => {
    const dataDir = createTempDir();
    const store = createMissionControlViewsStore({
      dataDir,
      now: () => Date.parse("2026-03-10T00:00:00.000Z"),
    });

    store.setActiveView("needs-review");

    const reloaded = createMissionControlViewsStore({
      dataDir,
      now: () => Date.parse("2026-03-10T01:00:00.000Z"),
    });

    assert.strictEqual(reloaded.getState().activeViewId, "needs-review");
    assert.ok(reloaded.getState().views.some((view) => view.id === "today"));
  });
});

describe("mission control service", () => {
  it("replays card timelines and surfaces diagnostics", async () => {
    const dataDir = createTempDir();
    let currentTime = Date.parse("2026-03-10T04:00:00.000Z");
    const now = () => currentTime;
    const issues = [
      createIssue(),
      createIssue({
        id: "issue-2",
        identifier: "ARC-99",
        title: "Needs review",
        updatedAt: "2026-03-09T00:00:00.000Z",
        labels: [
          { id: "label-1", name: "lane:pepper", color: "#d29922" },
          { id: "label-2", name: "risk:high", color: "#f85149" },
        ],
        state: {
          id: "state-review",
          name: "In Review",
          type: "started",
          color: "#d29922",
        },
        project: {
          id: "project-2",
          name: "Dispatch",
          slug: "littlebrief",
          progress: 10,
        },
      }),
    ];

    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now,
      logger: { error() {}, log() {} },
      linearClient: {
        fetchIssuesForProjects: async () => issues,
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await service.reconcile({ reason: "manual" });
    const state = service.getPublicState();

    assert.strictEqual(state.stats.totalCards, 2);
    assert.strictEqual(state.activeView.name, "Today");

    const card = state.masterCards.find((entry) => entry.primaryLinearIdentifier === "ARC-38");
    assert.ok(card, "expected synchronized card");

    const timeline = service.getCardTimeline(card.id);
    const replay = service.replayCardTimeline(card.id);
    const diagnostics = service.getDiagnostics();

    assert.ok(timeline.some((event) => event.type === "mission-control.linear.card-upserted"));
    assert.ok(replay.some((step) => step.snapshot?.identifier === "ARC-38"));
    assert.ok(
      diagnostics.affectedCards.some((entry) => entry.primaryLinearIdentifier === "ARC-99"),
    );
    assert.strictEqual(
      diagnostics.affectedCards.find((entry) => entry.primaryLinearIdentifier === "ARC-99")
        .diagnostics.stale,
      true,
    );
  });

  it("rolls linked Linear issues into one outcome card without top-level dupes", async () => {
    const dataDir = createTempDir();
    const observedProjectSlugs = [];
    const service = createMissionControlService({
      config: createConfig({
        integrations: {
          linear: {
            projectSlugs: ["littlebrief"],
          },
        },
        missionControl: {
          projects: [
            {
              key: "littlebrief",
              repoPath: "~/dev/arcqdev/littlebrief",
              linearProjectSlug: "littlebrief",
              lane: "lane:jon",
              symphonyPort: 45123,
            },
            {
              key: "ops-board",
              repoPath: "~/dev/arcqdev/ops-board",
              linearProjectSlug: "ops-board",
              lane: "lane:jon",
              symphonyPort: null,
            },
          ],
          outcomes: [
            {
              key: "jon-big-task",
              missionKey: "mission-jon-big-task",
              title: "Jon do this big task",
              summary: "Parent outcome for a multi-board request.",
              lane: "lane:jon",
              linkedLinearIdentifiers: ["ARC-38", "OPS-12"],
              linkedLinearProjectSlugs: ["littlebrief", "ops-board"],
              linkedProjectKeys: ["littlebrief", "ops-board"],
              links: [
                {
                  kind: "project",
                  label: "Littlebrief board",
                  url: "https://linear.app/arcqdev/project/littlebrief",
                  projectSlug: "littlebrief",
                },
                {
                  kind: "project",
                  label: "Ops board",
                  url: "https://linear.app/arcqdev/project/ops-board",
                  projectSlug: "ops-board",
                },
              ],
            },
          ],
        },
      }),
      dataDir,
      now: () => Date.parse("2026-03-10T04:00:00.000Z"),
      logger: { error() {}, log() {} },
      linearClient: {
        fetchIssuesForProjects: async ({ projectSlugs }) => {
          observedProjectSlugs.push(...projectSlugs);
          return [
            createIssue(),
            createIssue({
              id: "issue-ops-12",
              identifier: "OPS-12",
              title: "Cross-board follow-up",
              url: "https://linear.app/arcqdev/issue/OPS-12",
              project: {
                id: "project-2",
                name: "Ops Board",
                slug: "ops-board",
                progress: 20,
              },
              updatedAt: "2026-03-10T03:00:00.000Z",
            }),
          ];
        },
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await service.reconcile({ reason: "manual" });
    const state = service.getPublicState();
    const outcome = state.masterCards.find((entry) => entry.outcomeId === "jon-big-task");

    assert.ok(outcome, "expected rolled-up outcome card");
    assert.strictEqual(state.stats.totalCards, 1);
    assert.deepStrictEqual([...new Set(observedProjectSlugs)].sort(), ["littlebrief", "ops-board"]);
    assert.strictEqual(outcome.identifier, "mission-jon-big-task");
    assert.strictEqual(outcome.cardType, "outcome");
    assert.strictEqual(outcome.linearChildren.length, 2);
    assert.strictEqual(outcome.childStats.linkedIssueTargetCount, 2);
    assert.strictEqual(outcome.childStats.matchedIssueCount, 2);
    assert.strictEqual(outcome.linkedProjects.length, 2);
    assert.ok(outcome.links.some((link) => link.kind === "project"));
    assert.ok(outcome.links.some((link) => link.kind === "issue"));
  });
});
