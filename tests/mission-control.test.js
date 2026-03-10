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

function createConfig() {
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
          key: "growth",
          repoPath: "~/dev/arcqdev/growth",
          linearProjectSlug: "growth-board",
          lane: "lane:mia",
          symphonyPort: null,
        },
      ],
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

  it("creates cross-lane child tasks through the parent owner and refreshes board state", async () => {
    const dataDir = createTempDir();
    const now = () => Date.parse("2026-03-10T04:00:00.000Z");
    const createdInputs = [];
    const parentIssueId = "issue-1";
    const issuesById = new Map();
    const parentIssue = createIssue({
      id: parentIssueId,
      identifier: "ARC-38",
      labels: [
        { id: "lane-jon", name: "lane:jon", color: "#58a6ff" },
        { id: "dispatch-ready", name: "dispatch:ready", color: "#3fb950" },
      ],
    });
    issuesById.set(parentIssue.id, parentIssue);

    const linearClient = {
      fetchIssuesForProjects: async () => [issuesById.get(parentIssueId)],
      fetchIssuesByIds: async ({ issueIds }) =>
        issueIds.map((issueId) => issuesById.get(issueId)).filter(Boolean),
      resolveProjectBySlug: async (projectSlug) => ({
        id: "project-growth",
        name: "Growth",
        slug: projectSlug,
        team: {
          id: "team-growth",
          key: "ARC",
          name: "ArcQ Dev",
        },
      }),
      resolveLabelIdsForTeam: async ({ labelNames }) => labelNames.map((label) => `label:${label}`),
      createIssue: async (input) => {
        createdInputs.push(input);
        const childIssue = createIssue({
          id: "issue-2",
          identifier: "ARC-120",
          title: input.title,
          description: input.description,
          project: {
            id: "project-growth",
            name: "Growth",
            slug: "growth-board",
            progress: 0,
          },
          state: {
            id: "state-todo",
            name: "Todo",
            type: "unstarted",
            color: "#999999",
          },
          labels: [
            { id: "lane-mia", name: "lane:mia", color: "#ff66aa" },
            { id: "risk-low", name: "risk:low", color: "#58a6ff" },
            { id: "dispatch-ready", name: "dispatch:ready", color: "#3fb950" },
          ],
          parentIssue: {
            id: parentIssueId,
            identifier: "ARC-38",
            title: parentIssue.title,
            updatedAt: parentIssue.updatedAt,
            state: parentIssue.state,
            project: parentIssue.project,
            labels: parentIssue.labels,
            linkRole: "parent",
            relationType: null,
          },
          linkedIssues: [
            {
              id: parentIssueId,
              identifier: "ARC-38",
              title: parentIssue.title,
              updatedAt: parentIssue.updatedAt,
              state: parentIssue.state,
              project: parentIssue.project,
              labels: parentIssue.labels,
              linkRole: "parent",
              relationType: null,
            },
          ],
          linkedIssueIds: [parentIssueId],
          linkedIssueIdentifiers: ["ARC-38"],
          linkedIssueProjectSlugs: ["littlebrief"],
        });

        issuesById.set(childIssue.id, childIssue);
        issuesById.set(parentIssueId, {
          ...issuesById.get(parentIssueId),
          linkedIssues: [
            {
              id: childIssue.id,
              identifier: childIssue.identifier,
              title: childIssue.title,
              updatedAt: childIssue.updatedAt,
              state: childIssue.state,
              project: childIssue.project,
              labels: childIssue.labels,
              linkRole: "child",
              relationType: null,
            },
          ],
          linkedIssueIds: [childIssue.id],
          linkedIssueIdentifiers: [childIssue.identifier],
          linkedIssueProjectSlugs: [childIssue.project.slug],
        });

        return childIssue;
      },
    };

    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now,
      logger: { error() {}, log() {} },
      linearClient,
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await service.reconcile({ reason: "manual" });
    const result = await service.createCrossLaneChildTask("ARC-38", {
      actor: "jon",
      title: "Prepare growth copy",
      description: "Cross-lane follow-up owned by Mia.",
      targetProjectSlug: "growth-board",
      lane: "lane:mia",
      risk: "risk:low",
      dispatch: "dispatch:ready",
    });

    assert.strictEqual(createdInputs.length, 1);
    assert.strictEqual(createdInputs[0].parentId, "issue-1");
    assert.strictEqual(createdInputs[0].projectId, "project-growth");
    assert.strictEqual(createdInputs[0].teamId, "team-growth");
    assert.deepStrictEqual(createdInputs[0].labelIds, [
      "label:lane:mia",
      "label:risk:low",
      "label:dispatch:ready",
    ]);
    assert.ok(result.childCard, "expected created child card to be materialized");
    assert.ok(result.parentCard, "expected refreshed parent card");
    assert.strictEqual(result.parentCard.status, "blocked");
    assert.strictEqual(result.parentCard.dispatchOwner, "pepper");
    assert.ok(
      result.parentCard.dependencies.some((dependency) => dependency.label === "ARC-120"),
      "expected parent card to track the child issue as a dependency",
    );
  });

  it("rejects cross-lane child creation when the actor is not the parent owner", async () => {
    const dataDir = createTempDir();
    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now: () => Date.parse("2026-03-10T04:00:00.000Z"),
      logger: { error() {}, log() {} },
      linearClient: {
        fetchIssuesForProjects: async () => [
          createIssue({
            labels: [{ id: "lane-jon", name: "lane:jon", color: "#58a6ff" }],
          }),
        ],
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: () => 1,
      clearTimeoutFn: () => {},
    });

    await service.reconcile({ reason: "manual" });

    await assert.rejects(
      () =>
        service.createCrossLaneChildTask("ARC-38", {
          actor: "mia",
          title: "Should fail",
          targetProjectSlug: "growth-board",
          lane: "lane:mia",
        }),
      /parent owner 'jon'/,
    );
  });
});
