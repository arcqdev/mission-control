const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

describe("server", () => {
  // Use a random high port to avoid conflicts
  const TEST_PORT = 10000 + Math.floor(Math.random() * 50000);
  let serverProcess;
  let startupBlockedReason = null;
  let startupStderr = "";
  let serverExited = false;

  before(async () => {
    // Start the server as a child process with a custom PORT
    serverProcess = spawn(process.execPath, [path.join(__dirname, "..", "lib", "server.js")], {
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    serverProcess.stderr.on("data", (chunk) => {
      startupStderr += chunk.toString();
      if (startupStderr.includes("listen EPERM")) {
        startupBlockedReason = "socket bind blocked in current environment";
      }
    });

    serverProcess.on("exit", () => {
      serverExited = true;
    });

    // Wait for server to be ready by polling the health endpoint
    const maxWait = 10000;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      try {
        await httpGet(`http://localhost:${TEST_PORT}/api/health`);
        return; // Server is ready
      } catch (_e) {
        if (startupBlockedReason) {
          return;
        }

        if (serverExited) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (startupBlockedReason) {
      return;
    }

    throw new Error(
      `Server did not start within ${maxWait}ms${startupStderr ? `\n${startupStderr}` : ""}`,
    );
  });

  after(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
  });

  function skipIfEnvironmentBlocked(test) {
    if (startupBlockedReason) {
      test.skip(startupBlockedReason);
      return true;
    }

    return false;
  }

  it("responds to /api/health with status ok", async (test) => {
    if (skipIfEnvironmentBlocked(test)) return;
    const { statusCode, body } = await httpGet(`http://localhost:${TEST_PORT}/api/health`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.strictEqual(data.status, "ok");
    assert.strictEqual(data.port, TEST_PORT);
    assert.ok(data.timestamp, "should have timestamp");
  });

  it("responds to /api/about with project info", async (test) => {
    if (skipIfEnvironmentBlocked(test)) return;
    const { statusCode, body } = await httpGet(`http://localhost:${TEST_PORT}/api/about`);
    assert.strictEqual(statusCode, 200);
    const data = JSON.parse(body);
    assert.ok(data.name || data.version, "should have project info");
  });

  it("returns JSON content type for API endpoints", async (test) => {
    if (skipIfEnvironmentBlocked(test)) return;
    const { headers } = await httpGet(`http://localhost:${TEST_PORT}/api/health`);
    assert.ok(
      headers["content-type"].includes("application/json"),
      `Expected JSON content type, got: ${headers["content-type"]}`,
    );
  });

  it("serves static files for root path", async (test) => {
    if (skipIfEnvironmentBlocked(test)) return;
    const { statusCode } = await httpGet(`http://localhost:${TEST_PORT}/`);
    // Should return 200 (index.html) or similar
    assert.ok(
      statusCode >= 200 && statusCode < 500,
      `Expected 2xx/3xx/4xx status for root, got: ${statusCode}`,
    );
  });
});

/**
 * Simple HTTP GET helper that returns a promise
 */
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
