const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { createNotificationsModule } = require("../src/mission-control/notifications");

const tempDirs = [];

function createTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-mc-"));
  tempDirs.push(dir);
  return dir;
}

function createConfig(webhookUrl, overrides = {}) {
  return {
    enabled: true,
    discord: {
      defaults: {
        senderKey: "mission-control",
        destinationKey: "ops-main",
      },
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
        ...(overrides.discord?.retry || {}),
      },
      senders: {
        "mission-control": {
          displayName: "Mission Control",
          avatarEmoji: "🛰️",
          defaultDestinationKey: "ops-main",
          ...(overrides.discord?.senders?.["mission-control"] || {}),
        },
      },
      destinations: {
        "ops-main": {
          label: "Ops Main",
          webhookUrl,
          allowedSenders: ["mission-control"],
          ...(overrides.discord?.destinations?.["ops-main"] || {}),
        },
      },
    },
  };
}

function createEvent(eventKey, overrides = {}) {
  return {
    eventKey,
    category: "completion",
    severity: "info",
    title: "ARC-28 shipped",
    summary: "Mission Control marked ARC-28 complete.",
    cardId: "mc-arc-28",
    issueIdentifier: "ARC-28",
    projectKey: "arcqdev",
    occurredAt: "2026-03-09T18:00:00.000Z",
    ...overrides,
  };
}

async function withWebhookServer(handler, testFn) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      const parsedBody = body ? JSON.parse(body) : null;
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: parsedBody,
      });

      try {
        await handler(req, res, requests);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(error.message);
      }
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const webhookUrl = `http://127.0.0.1:${address.port}/discord-webhook`;

  try {
    await testFn({ webhookUrl, requests });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Mission Control Discord notifications", () => {
  it("delivers completion notifications with a stable Discord payload", async () => {
    await withWebhookServer(
      async (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      async ({ webhookUrl, requests }) => {
        const dataDir = createTempDataDir();
        const notifications = createNotificationsModule({
          config: createConfig(webhookUrl),
          dataDir,
          sleep: async () => {},
        });

        const result = await notifications.deliverEvent(createEvent("arc-28-complete"));
        assert.strictEqual(result.delivered, true);
        assert.strictEqual(requests.length, 1);

        const payload = requests[0].body;
        assert.strictEqual(payload.username, "Mission Control");
        assert.strictEqual(payload.content, "🛰️ [Mission Control] ARC-28 shipped");
        assert.ok(Array.isArray(payload.embeds));
        assert.strictEqual(payload.embeds.length, 1);
        assert.strictEqual(payload.embeds[0].title, "ARC-28 shipped");
        assert.strictEqual(payload.embeds[0].description, "Mission Control marked ARC-28 complete.");
        assert.strictEqual(payload.embeds[0].footer.text, "Mission Control • arc-28-complete");
        assert.deepStrictEqual(
          payload.embeds[0].fields.map((field) => field.name),
          ["Category", "Severity", "Card", "Issue", "Project", "Destination"],
        );

        const snapshot = notifications.getState();
        assert.strictEqual(snapshot.delivery.deliveredCount, 1);
        assert.strictEqual(snapshot.alertBanner.visible, false);

        const notificationsFile = path.join(dataDir, "mission-control", "notifications.json");
        assert.ok(snapshot.updatedAt, "should update notification snapshot timestamp");
        assert.ok(fs.existsSync(notificationsFile), "should persist notifications ledger");
      },
    );
  });

  it("retries once after a Discord 429 and then succeeds", async () => {
    let attempt = 0;

    await withWebhookServer(
      async (_req, res) => {
        attempt += 1;
        if (attempt === 1) {
          res.writeHead(429, { "Retry-After": "0", "Content-Type": "text/plain" });
          res.end("rate limited");
          return;
        }

        res.writeHead(204);
        res.end();
      },
      async ({ webhookUrl, requests }) => {
        const notifications = createNotificationsModule({
          config: createConfig(webhookUrl),
          dataDir: createTempDataDir(),
          sleep: async () => {},
        });

        const result = await notifications.deliverEvent(createEvent("arc-28-rate-limit"));
        assert.strictEqual(result.delivered, true);
        assert.strictEqual(requests.length, 2);

        const snapshot = notifications.getState();
        assert.strictEqual(snapshot.delivery.deliveredCount, 1);
        assert.strictEqual(snapshot.delivery.recent[0].attempts, 2);
        assert.strictEqual(snapshot.delivery.recent[0].status, "delivered");
        assert.strictEqual(snapshot.alertBanner.visible, false);
      },
    );
  });

  it("moves 5xx delivery failures to dead-letter after bounded retries", async () => {
    await withWebhookServer(
      async (_req, res) => {
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("discord unavailable");
      },
      async ({ webhookUrl, requests }) => {
        const notifications = createNotificationsModule({
          config: createConfig(webhookUrl),
          dataDir: createTempDataDir(),
          sleep: async () => {},
        });

        const result = await notifications.deliverEvent(
          createEvent("arc-28-exception", {
            category: "exception",
            severity: "critical",
            title: "ARC-28 delivery exception",
            summary: "Discord kept returning 5xx for this alert.",
          }),
        );

        assert.strictEqual(result.delivered, false);
        assert.strictEqual(requests.length, 3);
        assert.strictEqual(result.record.deadLetter, true);
        assert.strictEqual(result.record.status, "failed");
        assert.strictEqual(result.record.attempts, 3);

        const snapshot = notifications.getState();
        assert.strictEqual(snapshot.delivery.deadLetterCount, 1);
        assert.strictEqual(snapshot.alertBanner.visible, true);
        assert.strictEqual(snapshot.alertBanner.severity, "critical");
      },
    );
  });

  it("dedupes repeated event keys to avoid duplicate floods", async () => {
    await withWebhookServer(
      async (_req, res) => {
        res.writeHead(204);
        res.end();
      },
      async ({ webhookUrl, requests }) => {
        const notifications = createNotificationsModule({
          config: createConfig(webhookUrl),
          dataDir: createTempDataDir(),
          sleep: async () => {},
        });

        const first = await notifications.deliverEvent(createEvent("arc-28-dedupe"));
        const second = await notifications.deliverEvent(createEvent("arc-28-dedupe"));

        assert.strictEqual(first.delivered, true);
        assert.strictEqual(second.deduped, true);
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(notifications.getState().delivery.recent[0].dedupeHits, 1);
      },
    );
  });
});
