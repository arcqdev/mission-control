const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");

describe("config module", () => {
  // Save original env to restore after tests
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars after each test
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    // Clear require cache so config reloads fresh
    for (const key of Object.keys(require.cache)) {
      if (key.includes("config.js")) {
        delete require.cache[key];
      }
    }
  });

  describe("expandPath()", () => {
    it("expands ~ to home directory", () => {
      const { expandPath } = require("../src/config");
      const result = expandPath("~/some/path");
      assert.strictEqual(result, path.join(os.homedir(), "some", "path"));
    });

    it("expands $HOME to home directory", () => {
      const { expandPath } = require("../src/config");
      const result = expandPath("$HOME/docs");
      assert.strictEqual(result, path.join(os.homedir(), "docs"));
    });

    it("expands ${HOME} to home directory", () => {
      const { expandPath } = require("../src/config");
      const result = expandPath("${HOME}/docs");
      assert.strictEqual(result, path.join(os.homedir(), "docs"));
    });

    it("returns null/undefined as-is", () => {
      const { expandPath } = require("../src/config");
      assert.strictEqual(expandPath(null), null);
      assert.strictEqual(expandPath(undefined), undefined);
    });

    it("returns path unchanged when no expansion needed", () => {
      const { expandPath } = require("../src/config");
      assert.strictEqual(expandPath("/absolute/path"), "/absolute/path");
    });
  });

  describe("detectWorkspace()", () => {
    it("returns a string path", () => {
      const { detectWorkspace } = require("../src/config");
      const result = detectWorkspace();
      assert.strictEqual(typeof result, "string");
      assert.ok(result.length > 0, "workspace path should not be empty");
    });

    it("returns an absolute path", () => {
      const { detectWorkspace } = require("../src/config");
      const result = detectWorkspace();
      assert.ok(path.isAbsolute(result), `Expected absolute path, got: ${result}`);
    });
  });

  describe("loadConfig()", () => {
    it("returns an object with all required top-level keys", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.ok(config.server, "config should have server");
      assert.ok(config.paths, "config should have paths");
      assert.ok(config.auth, "config should have auth");
      assert.ok(config.branding, "config should have branding");
      assert.ok(config.integrations, "config should have integrations");
    });

    it("has default port of 3333", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.server.port, 3333);
    });

    it("has default auth mode of 'none'", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.auth.mode, "none");
    });

    it("has default host of localhost", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.server.host, "localhost");
    });

    it("has workspace path set", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.ok(config.paths.workspace, "workspace path should be set");
      assert.strictEqual(typeof config.paths.workspace, "string");
    });

    it("has memory path set", () => {
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.ok(config.paths.memory, "memory path should be set");
    });
  });

  describe("environment variable overrides", () => {
    it("PORT env var overrides default port", () => {
      process.env.PORT = "9999";
      // Clear cache to force re-require
      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.server.port, 9999);
    });

    it("HOST env var overrides default host", () => {
      process.env.HOST = "0.0.0.0";
      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.server.host, "0.0.0.0");
    });

    it("DASHBOARD_AUTH_MODE env var overrides auth mode", () => {
      process.env.DASHBOARD_AUTH_MODE = "token";
      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.strictEqual(config.auth.mode, "token");
    });

    it("LINEAR_PROJECT_SLUGS env var parses into project slugs", () => {
      process.env.LINEAR_API_KEY = "linear-key";
      process.env.LINEAR_PROJECT_SLUGS = "mission-control, command-center ";
      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }
      const { loadConfig } = require("../src/config");
      const config = loadConfig();
      assert.deepStrictEqual(config.integrations.linear.projectSlugs, [
        "mission-control",
        "command-center",
      ]);
      assert.strictEqual(config.integrations.linear.enabled, true);
    });

    it("MISSION_CONTROL_PROJECTS_JSON env var parses the project registry", () => {
      process.env.MISSION_CONTROL_PROJECTS_JSON = JSON.stringify([
        {
          key: "mission-control",
          linearProjectSlug: "mission-control",
          lane: "lane:jon",
          symphonyPort: 45123,
        },
      ]);

      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }

      const { loadConfig } = require("../src/config");
      const config = loadConfig();

      assert.strictEqual(config.missionControl.projects[0].lane, "lane:jon");
      assert.strictEqual(config.missionControl.projects[0].symphonyPort, 45123);
    });

    it("LINEAR_WEBHOOK_PATH env var overrides the default webhook path", () => {
      process.env.LINEAR_API_KEY = "linear-key";
      process.env.LINEAR_PROJECT_SLUGS = "littlebrief,mission-control";
      process.env.LINEAR_WEBHOOK_PATH = "/api/integrations/linear/webhook";

      for (const key of Object.keys(require.cache)) {
        if (key.includes("config.js")) {
          delete require.cache[key];
        }
      }

      const { loadConfig } = require("../src/config");
      const config = loadConfig();

      assert.deepStrictEqual(config.integrations.linear.projectSlugs, [
        "littlebrief",
        "mission-control",
      ]);
      assert.strictEqual(
        config.integrations.linear.webhookPath,
        "/api/integrations/linear/webhook",
      );
    });
  });
});

describe("Mission Control auth posture", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);

    for (const key of Object.keys(require.cache)) {
      if (key.includes("config.js")) {
        delete require.cache[key];
      }
    }
  });

  it("adds the Linear webhook path to public paths when a secret is configured", () => {
    process.env.LINEAR_WEBHOOK_SECRET = "zerg-rush";
    process.env.LINEAR_WEBHOOK_PATH = "/api/integrations/linear/custom-webhook";

    const { loadConfig } = require("../src/config");
    const config = loadConfig();

    assert.ok(config.auth.publicPaths.includes("/api/integrations/linear/custom-webhook"));
  });

  it("keeps Mission Control read and admin APIs behind normal auth", () => {
    const { loadConfig } = require("../src/config");
    const config = loadConfig();

    assert.ok(!config.auth.publicPaths.includes("/api/mission-control/board"));
    assert.ok(!config.auth.publicPaths.includes("/api/mission-control/admin/reconcile"));
  });
});
