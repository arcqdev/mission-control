const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawnSync, spawn } = require("node:child_process");

function canBindLocalPort() {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      [
        'const net = require("net");',
        "const server = net.createServer();",
        'server.once("error", () => process.exit(1));',
        'server.listen(0, "127.0.0.1", () => server.close(() => process.exit(0)));',
      ].join(" "),
    ],
    { encoding: "utf8" },
  );

  return probe.status === 0;
}

const describeServer = canBindLocalPort() ? describe : describe.skip;
const WEBHOOK_SECRET = "zerg-rush";

function createIssue(overrides = {}) {
  return {
    id: "issue-arc-26",
    identifier: "ARC-26",
    title: "Expose Mission Control API",
    description: "Mission Control backend surfaces",
    url: "https://linear.app/arcqdev/issue/ARC-26",
    priority: 1,
    estimate: 3,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:01:00.000Z",
    state: {
      id: "state-started",
      name: "In Progress",
      type: "started",
      color: "#ffcc00",
    },
    project: {
      id: "project-1",
      name: "Mission Control",
      slug: "mission-control",
      progress: 25,
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
    labels: [{ id: "label-1", name: "api", color: "#ff00ff" }],
    cycle: null,
    ...overrides,
  };
}

function signPayload(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function httpRequest(url, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, (res) => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: responseBody,
        });
      });
    });

    request.on("error", reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

async function waitForServer(port, headers = {}) {
  const maxWait = 10000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      await httpRequest(`http://127.0.0.1:${port}/api/health`, { headers });
      return;
    } catch (_error) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  throw new Error(`Timed out waiting for server on port ${port}`);
}

function startServer({ port, tempHome, workspaceDir, extraEnv = {} }) {
  return spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
    env: {
      ...process.env,
      HOME: tempHome,
      OPENCLAW_WORKSPACE: workspaceDir,
      PORT: String(port),
      HOST: "127.0.0.1",
      LINEAR_PROJECT_SLUGS: "mission-control",
      LINEAR_WEBHOOK_SECRET: WEBHOOK_SECRET,
      ...extraEnv,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function parseSseFrame(frame) {
  const event = { event: "message", data: "" };

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      event.event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      event.data += `${line.slice(5).trim()}\n`;
    }
  }

  event.data = event.data.trim();
  return event;
}

function waitForMissionControlEvent(port, predicate, trigger, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(`http://127.0.0.1:${port}/api/events`, { headers }, (res) => {
      res.setEncoding("utf8");
      let buffer = "";
      let triggered = false;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out waiting for Mission Control SSE event"));
      }, 5000);

      function cleanup() {
        clearTimeout(timeout);
        request.destroy();
        res.destroy();
      }

      res.on("data", (chunk) => {
        buffer += chunk;

        while (buffer.includes("\n\n")) {
          const boundaryIndex = buffer.indexOf("\n\n");
          const frame = buffer.slice(0, boundaryIndex);
          buffer = buffer.slice(boundaryIndex + 2);

          const parsed = parseSseFrame(frame);
          if (!triggered) {
            triggered = true;
            Promise.resolve()
              .then(() => trigger())
              .catch((error) => {
                cleanup();
                reject(error);
              });
          }

          if (parsed.event !== "mission-control" || !parsed.data) {
            continue;
          }

          const payload = JSON.parse(parsed.data);
          if (!predicate(payload)) {
            continue;
          }

          cleanup();
          resolve(payload);
          return;
        }
      });
    });

    request.on("error", reject);
    request.end();
  });
}

async function postWebhook(port, issue, deliveryId) {
  const payload = JSON.stringify({
    action: "update",
    webhookTimestamp: new Date().toISOString(),
    data: issue,
  });

  return httpRequest(`http://127.0.0.1:${port}/api/integrations/linear/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      "linear-signature": signPayload(WEBHOOK_SECRET, payload),
      "linear-delivery": deliveryId,
    },
    body: payload,
  });
}

describeServer("server", () => {
  const TEST_PORT = 10000 + Math.floor(Math.random() * 50000);
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-server-"));
  const workspaceDir = path.join(tempHome, ".openclaw", "workspace");
  let serverProcess;

  before(async () => {
    fs.mkdirSync(path.join(workspaceDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "state"), { recursive: true });

    serverProcess = startServer({ port: TEST_PORT, tempHome, workspaceDir });
    await waitForServer(TEST_PORT);

    const webhookResult = await postWebhook(TEST_PORT, createIssue(), "delivery-seed");
    assert.strictEqual(webhookResult.statusCode, 202);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
  });

  it("responds to /api/health with status ok", async () => {
    const { statusCode, body } = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/health`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.port, TEST_PORT);
    assert.ok(data.timestamp);
  });

  it("responds to /api/about with project info", async () => {
    const { statusCode, body } = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/about`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.ok(data.name || data.version);
  });

  it("returns JSON content type for API endpoints", async () => {
    const { headers } = await httpRequest(`http://127.0.0.1:${TEST_PORT}/api/health`);
    assert.ok(headers["content-type"].includes("application/json"));
  });

  it("serves stable Mission Control board/filter/health/sync/admin payloads", async () => {
    const [boardRes, filtersRes, healthRes, syncRes, adminRes] = await Promise.all([
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/board`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/filters`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/health`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/sync`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/admin/status`),
    ]);

    const board = JSON.parse(boardRes.body);
    const filters = JSON.parse(filtersRes.body);
    const health = JSON.parse(healthRes.body);
    const sync = JSON.parse(syncRes.body);
    const admin = JSON.parse(adminRes.body);

    assert.strictEqual(boardRes.statusCode, 200);
    assert.strictEqual(board.masterCards[0].identifier, "ARC-26");
    assert.strictEqual(filters.filters.projects[0].slug, "mission-control");
    assert.strictEqual(typeof health.health.status, "string");
    assert.strictEqual(typeof sync.sync.status, "string");
    assert.strictEqual(typeof admin.sse.clientCount, "number");
  });

  it("triggers safe admin reconcile and replay endpoints", async () => {
    const reconcileRes = await httpRequest(
      `http://127.0.0.1:${TEST_PORT}/api/mission-control/admin/reconcile`,
      { method: "POST" },
    );
    const replayRes = await httpRequest(
      `http://127.0.0.1:${TEST_PORT}/api/mission-control/admin/replay`,
      { method: "POST" },
    );

    const reconcile = JSON.parse(reconcileRes.body);
    const replay = JSON.parse(replayRes.body);

    assert.strictEqual(reconcileRes.statusCode, 200);
    assert.strictEqual(reconcile.ok, true);
    assert.strictEqual(reconcile.board.masterCards.length, 1);
    assert.strictEqual(replayRes.statusCode, 200);
    assert.strictEqual(replay.ok, true);
    assert.strictEqual(replay.board.masterCards.length, 1);
  });

  it("rejects malformed cross-lane child creation requests before reaching Linear", async () => {
    const response = await httpRequest(
      `http://127.0.0.1:${TEST_PORT}/api/mission-control/cards/ARC-26/cross-lane-child`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "{invalid json",
      },
    );

    const payload = JSON.parse(response.body);
    assert.strictEqual(response.statusCode, 400);
    assert.match(payload.error, /Invalid JSON/);
  });

  it("returns 404 when creating a cross-lane child for an unknown card", async () => {
    const response = await httpRequest(
      `http://127.0.0.1:${TEST_PORT}/api/mission-control/cards/ARC-404/cross-lane-child`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: "jon",
          title: "Create cross-lane child",
          targetProjectSlug: "growth-board",
          lane: "lane:mia",
        }),
      },
    );

    const payload = JSON.parse(response.body);
    assert.strictEqual(response.statusCode, 404);
    assert.match(payload.error, /card not found/i);
  });

  it("streams Mission Control card deltas over the shared SSE endpoint", async () => {
    const updatedIssue = createIssue({
      updatedAt: "2026-03-10T00:10:00.000Z",
      state: {
        id: "state-done",
        name: "Done",
        type: "completed",
        color: "#00ff99",
      },
    });

    const payload = await waitForMissionControlEvent(
      TEST_PORT,
      (event) => event.type === "card-upserted" && event.delta?.identifier === "ARC-26",
      () => postWebhook(TEST_PORT, updatedIssue, "delivery-update"),
    );

    assert.strictEqual(payload.type, "card-upserted");
    assert.strictEqual(payload.delta.action, "updated");
    assert.strictEqual(payload.delta.card.state.name, "Done");
  });

  it("exposes Mission Control notification state", async () => {
    const { statusCode, body } = await httpGet(`http://localhost:${TEST_PORT}/api/mission-control/state`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.ok(data.notifications, "should include notification state");
    assert.strictEqual(typeof data.notifications.enabled, "boolean");
    assert.ok(data.notifications.delivery, "should include delivery summary");
  });

  it("serves static files for root path", async () => {
    const { statusCode } = await httpRequest(`http://127.0.0.1:${TEST_PORT}/`);
    assert.ok(statusCode >= 200 && statusCode < 500);
  });
});

describeServer("server auth posture for Mission Control", () => {
  const TEST_PORT = 10000 + Math.floor(Math.random() * 50000);
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-server-auth-"));
  const workspaceDir = path.join(tempHome, ".openclaw", "workspace");
  const authHeaders = { authorization: "Bearer mission-control-token" };
  let serverProcess;

  before(async () => {
    fs.mkdirSync(path.join(workspaceDir, "memory"), { recursive: true });
    fs.mkdirSync(path.join(workspaceDir, "state"), { recursive: true });

    serverProcess = startServer({
      port: TEST_PORT,
      tempHome,
      workspaceDir,
      extraEnv: {
        DASHBOARD_AUTH_MODE: "token",
        DASHBOARD_AUTH_TOKEN: "mission-control-token",
      },
    });
    await waitForServer(TEST_PORT, authHeaders);

    const webhookResult = await postWebhook(TEST_PORT, createIssue(), "delivery-auth-seed");
    assert.strictEqual(webhookResult.statusCode, 202);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
  });

  it("preserves the standard localhost trust posture for Mission Control endpoints in token mode", async () => {
    const [boardRes, syncRes, adminRes, reconcileRes, whoamiRes] = await Promise.all([
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/board`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/sync`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/admin/status`),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/mission-control/admin/reconcile`, {
        method: "POST",
      }),
      httpRequest(`http://127.0.0.1:${TEST_PORT}/api/whoami`),
    ]);

    const board = JSON.parse(boardRes.body);
    const admin = JSON.parse(adminRes.body);
    const reconcile = JSON.parse(reconcileRes.body);
    const whoami = JSON.parse(whoamiRes.body);

    assert.strictEqual(boardRes.statusCode, 200);
    assert.strictEqual(board.masterCards[0].identifier, "ARC-26");
    assert.strictEqual(syncRes.statusCode, 200);
    assert.strictEqual(adminRes.statusCode, 200);
    assert.strictEqual(typeof admin.sync.status, "string");
    assert.strictEqual(reconcileRes.statusCode, 200);
    assert.strictEqual(reconcile.ok, true);
    assert.strictEqual(whoamiRes.statusCode, 200);
    assert.strictEqual(whoami.authMode, "token");
    assert.strictEqual(whoami.user, null);
  });

  it("continues streaming Mission Control deltas over SSE while token auth is enabled", async () => {
    const updatedIssue = createIssue({
      updatedAt: "2026-03-10T00:12:00.000Z",
      state: {
        id: "state-review",
        name: "In Review",
        type: "started",
        color: "#66ccff",
      },
    });

    const payload = await waitForMissionControlEvent(
      TEST_PORT,
      (event) => event.type === "card-upserted" && event.delta?.identifier === "ARC-26",
      () => postWebhook(TEST_PORT, updatedIssue, "delivery-auth-update"),
      { headers: authHeaders },
    );

    assert.strictEqual(payload.type, "card-upserted");
    assert.strictEqual(payload.delta.card.state.name, "In Review");
  });

  it("keeps localhost access to the cross-lane child route in token mode", async () => {
    const response = await httpRequest(
      `http://127.0.0.1:${TEST_PORT}/api/mission-control/cards/ARC-404/cross-lane-child`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actor: "jon",
          title: "Create cross-lane child",
          targetProjectSlug: "growth-board",
          lane: "lane:mia",
        }),
      },
    );

    assert.strictEqual(response.statusCode, 404);
  });
});
