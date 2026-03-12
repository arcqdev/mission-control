const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createMissionControlService } = require("../src/mission-control");

const tempDirs = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mc-notify-"));
  tempDirs.push(dir);
  return dir;
}

function createTimerHarness() {
  let nextId = 1;
  let queue = [];

  return {
    setTimeoutFn(fn, delay = 0) {
      const id = nextId++;
      queue.push({ id, fn, delay });
      return id;
    },
    clearTimeoutFn(id) {
      queue = queue.filter((entry) => entry.id !== id);
    },
    peekDelays() {
      return queue.map((entry) => entry.delay);
    },
    async runNext() {
      if (queue.length === 0) {
        return false;
      }
      const next = queue.shift();
      await next.fn();
      await new Promise((resolve) => setImmediate(resolve));
      return true;
    },
    async runAll(limit = 20) {
      let remaining = limit;
      while (queue.length > 0) {
        if (remaining <= 0) {
          throw new Error("Timer queue did not settle");
        }
        remaining -= 1;
        const next = queue.shift();
        await next.fn();
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
  };
}

function createIssue(overrides = {}) {
  return {
    id: "issue-1",
    identifier: "ARC-36",
    title: "Implement Mission Control Discord notification pipeline",
    description: "Deliver Discord notifications for Mission Control events.",
    url: "https://linear.app/arcqdev/issue/ARC-36",
    priority: 2,
    estimate: 3,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T04:00:00.000Z",
    completedAt: "2026-03-10T04:00:00.000Z",
    state: {
      id: "state-done",
      name: "Done",
      type: "completed",
      color: "#3fb950",
    },
    project: {
      id: "project-1",
      name: "Littlebrief",
      slug: "littlebrief",
      progress: 100,
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
      ],
      discordDestinations: [
        {
          key: "jon",
          channelLabel: "Jon Ops",
          webhookUrl: "https://discord.example/webhooks/jon",
          allowedSenderIdentities: ["jon"],
        },
      ],
      outcomes: overrides.missionControl?.outcomes || [],
    },
  };
}

function createDiscordResponse({ ok, status, retryAfter, body = "" }) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "retry-after" ? retryAfter || null : null;
      },
    },
    text: async () => body,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("Mission Control Discord notifications", () => {
  it("delivers stable completion payloads without duplicate floods", async () => {
    const dataDir = createTempDir();
    const timers = createTimerHarness();
    const calls = [];
    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now: () => Date.parse("2026-03-10T04:05:00.000Z"),
      logger: { error() {}, warn() {} },
      linearClient: {
        fetchIssuesForProjects: async () => [createIssue()],
      },
      discordFetchImpl: async (url, options) => {
        calls.push({ url, options });
        return createDiscordResponse({ ok: true, status: 204 });
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await service.reconcile({ reason: "manual" });
    await timers.runAll();

    const firstState = service.getPublicState();
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].url, "https://discord.example/webhooks/jon");

    const payload = JSON.parse(calls[0].options.body);
    assert.strictEqual(payload.username, "Mission Control");
    assert.strictEqual(payload.allowed_mentions.parse.length, 0);
    assert.match(payload.content, /Mission complete: ARC-36 completed/);
    assert.strictEqual(payload.embeds[0].title, "ARC-36 completed");
    assert.match(payload.embeds[0].footer.text, /Mission Control notification v1 • completion/);
    assert.strictEqual(firstState.notifications.stats.delivered, 1);
    assert.strictEqual(firstState.notifications.stats.deadLetters, 0);
    assert.strictEqual(firstState.notifications.recentDeliveries[0].category, "completion");

    await service.reconcile({ reason: "manual" });
    await timers.runAll();

    assert.strictEqual(calls.length, 1);
  });

  it("retries 429 Discord responses with backoff and then succeeds", async () => {
    const dataDir = createTempDir();
    const timers = createTimerHarness();
    const calls = [];
    let attempt = 0;
    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now: () => Date.parse("2026-03-10T04:05:00.000Z"),
      logger: { error() {}, warn() {} },
      linearClient: {
        fetchIssuesForProjects: async () => [createIssue()],
      },
      discordFetchImpl: async () => {
        attempt += 1;
        calls.push(attempt);
        if (attempt === 1) {
          return createDiscordResponse({
            ok: false,
            status: 429,
            retryAfter: "2",
            body: "rate limited",
          });
        }
        return createDiscordResponse({ ok: true, status: 204 });
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await service.reconcile({ reason: "manual" });
    await timers.runNext();

    let state = service.getPublicState();
    assert.strictEqual(state.notifications.stats.retrying, 1);
    assert.strictEqual(state.notifications.recentDeliveries[0].responseStatus, 429);
    assert.strictEqual(timers.peekDelays()[0], 2000);

    await timers.runNext();
    state = service.getPublicState();

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(state.notifications.stats.delivered, 1);
    assert.strictEqual(state.notifications.stats.deadLetters, 0);
    assert.strictEqual(state.notifications.alertBanner, null);
  });

  it("dead-letters repeated 5xx exception alerts without creating duplicate floods", async () => {
    const dataDir = createTempDir();
    const timers = createTimerHarness();
    let calls = 0;
    const service = createMissionControlService({
      config: createConfig(),
      dataDir,
      now: () => Date.parse("2026-03-10T04:05:00.000Z"),
      logger: { error() {}, warn() {} },
      linearClient: {
        fetchIssuesForProjects: async () => {
          throw new Error("Linear unavailable");
        },
      },
      discordFetchImpl: async () => {
        calls += 1;
        return createDiscordResponse({ ok: false, status: 500, body: "discord outage" });
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await service.reconcile({ reason: "manual" });
    await timers.runAll();

    let state = service.getPublicState();
    assert.strictEqual(calls, 4);
    assert.strictEqual(state.sync.status, "error");
    assert.strictEqual(state.notifications.stats.deadLetters, 1);
    assert.strictEqual(state.notifications.recentDeliveries[0].category, "exception");
    assert.strictEqual(state.notifications.recentDeliveries[0].status, "dead_letter");
    assert.strictEqual(state.notifications.alertBanner.level, "error");
    assert.match(state.notifications.recentDeliveries[0].title, /Mission Control exception/);

    await service.reconcile({ reason: "manual" });
    await timers.runAll();
    state = service.getPublicState();

    assert.strictEqual(calls, 4);
    assert.strictEqual(state.notifications.stats.deadLetters, 1);
  });

  it("sends one human-review alert per active review episode for rolled-up outcomes", async () => {
    const dataDir = createTempDir();
    const timers = createTimerHarness();
    const calls = [];
    const service = createMissionControlService({
      config: createConfig({
        missionControl: {
          outcomes: [
            {
              key: "jon-review-rollup",
              missionKey: "mission-jon-review-rollup",
              title: "Jon review rollup",
              lane: "lane:jon",
              linkedLinearIdentifiers: ["ARC-36"],
              linkedLinearProjectSlugs: ["littlebrief"],
              linkedProjectKeys: ["littlebrief"],
            },
          ],
        },
      }),
      dataDir,
      now: () => Date.parse("2026-03-10T04:05:00.000Z"),
      logger: { error() {}, warn() {} },
      linearClient: {
        fetchIssuesForProjects: async () => [
          createIssue({
            completedAt: null,
            state: {
              id: "state-review",
              name: "Awaiting Review",
              type: "review",
              color: "#d29922",
            },
            updatedAt: "2026-03-10T04:00:00.000Z",
          }),
        ],
      },
      discordFetchImpl: async (url, options) => {
        calls.push({ url, options });
        return createDiscordResponse({ ok: true, status: 204 });
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await service.reconcile({ reason: "manual" });
    await timers.runAll();
    await service.reconcile({ reason: "manual" });
    await timers.runAll();

    assert.strictEqual(calls.length, 1);
    const payload = JSON.parse(calls[0].options.body);
    assert.match(
      payload.content,
      /Human review required: mission-jon-review-rollup needs human review/,
    );
    assert.match(payload.embeds[0].footer.text, /Mission Control notification v1 • review/);
  });

  it("sends completion for a parent outcome when all linked children are terminal", async () => {
    const dataDir = createTempDir();
    const timers = createTimerHarness();
    const calls = [];
    const service = createMissionControlService({
      config: createConfig({
        integrations: {
          linear: {
            projectSlugs: ["littlebrief"],
          },
        },
        missionControl: {
          outcomes: [
            {
              key: "jon-big-task",
              missionKey: "mission-jon-big-task",
              title: "Jon big task",
              lane: "lane:jon",
              linkedLinearIdentifiers: ["ARC-36", "ARC-37"],
              linkedLinearProjectSlugs: ["littlebrief"],
              linkedProjectKeys: ["littlebrief"],
            },
          ],
        },
      }),
      dataDir,
      now: () => Date.parse("2026-03-10T04:05:00.000Z"),
      logger: { error() {}, warn() {} },
      linearClient: {
        fetchIssuesForProjects: async () => [
          createIssue(),
          createIssue({
            id: "issue-2",
            identifier: "ARC-37",
            title: "Second child",
            url: "https://linear.app/arcqdev/issue/ARC-37",
          }),
        ],
      },
      discordFetchImpl: async (url, options) => {
        calls.push({ url, options });
        return createDiscordResponse({ ok: true, status: 204 });
      },
      setIntervalFn: () => 1,
      clearIntervalFn: () => {},
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    await service.reconcile({ reason: "manual" });
    await timers.runAll();

    assert.strictEqual(calls.length, 1);
    const payload = JSON.parse(calls[0].options.body);
    assert.match(payload.content, /Mission complete: mission-jon-big-task completed/);
    assert.strictEqual(service.getPublicState().masterCards.length, 1);
    assert.strictEqual(service.getPublicState().masterCards[0].status, "completed");
  });
});
