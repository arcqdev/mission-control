const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const path = require("path");

const socketProbe = spawnSync(
  process.execPath,
  [
    "-e",
    [
      'const net = require("node:net");',
      'const server = net.createServer();',
      'server.on("error", (error) => {',
      '  console.error(error.code || error.message);',
      '  process.exit(1);',
      '});',
      'server.listen(0, "127.0.0.1", () => {',
      '  server.close(() => process.exit(0));',
      '});',
    ].join("\n"),
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const socketBindSupported = socketProbe.status === 0;
const skipReason = socketBindSupported
  ? false
  : `sandbox does not allow socket binding: ${(socketProbe.stderr || socketProbe.stdout || "unknown").trim()}`;

describe("server", { skip: skipReason }, () => {
  const TEST_PORT = 10000 + Math.floor(Math.random() * 50000);
  let serverProcess;

  before(async () => {
    serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(TEST_PORT) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const maxWait = 10000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      try {
        await httpGet(`http://127.0.0.1:${TEST_PORT}/api/health`);
        return;
      } catch (_e) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    throw new Error(`Server did not start within ${maxWait}ms`);
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
  });

  it("responds to /api/health with status ok", async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/health`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.port, TEST_PORT);
    assert.ok(data.timestamp, "should have timestamp");
  });

  it("responds to /api/about with project info", async () => {
    const { statusCode, body } = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/about`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.ok(data.name || data.version, "should have project info");
  });

  it("returns JSON content type for API endpoints", async () => {
    const { headers } = await httpGet(`http://127.0.0.1:${TEST_PORT}/api/health`);
    assert.ok(
      headers["content-type"].includes("application/json"),
      `Expected JSON content type, got: ${headers["content-type"]}`,
    );
  });

  it("serves static files for root path", async () => {
    const { statusCode } = await httpGet(`http://127.0.0.1:${TEST_PORT}/`);
    assert.ok(
      statusCode >= 200 && statusCode < 500,
      `Expected 2xx/3xx/4xx status for root, got: ${statusCode}`,
    );
  });
});

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          }),
        );
      })
      .on("error", reject);
  });
}
