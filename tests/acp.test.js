const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAcpModule } = require("../src/acp");

const tempDirs = [];

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-acp-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function writeTranscript(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
  );
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe("acp module", () => {
  it("summarizes configured ACP agents, bindings, and session activity", () => {
    const openclawDir = createTempDir();
    const now = Date.now();
    const agentsList = [
      {
        id: "main",
        workspace: path.join(openclawDir, "workspace"),
        agentDir: path.join(openclawDir, "agents", "main", "agent"),
        model: "openai-codex/gpt-5.3-codex",
        isDefault: true,
        routes: ["default (no explicit rules)"],
      },
      {
        id: "mia",
        name: "Mia",
        workspace: path.join(openclawDir, "workspace-mia"),
        agentDir: path.join(openclawDir, "agents", "mia", "agent"),
        model: "zai/glm-5",
        isDefault: false,
      },
    ];

    const bindings = [
      {
        agentId: "main",
        match: { channel: "discord", accountId: "pepper" },
        description: "discord accountId=pepper",
      },
      {
        agentId: "mia",
        match: { channel: "discord", accountId: "mia" },
        description: "discord accountId=mia",
      },
    ];

    const mainSessionFile = path.join(
      openclawDir,
      "agents",
      "main",
      "sessions",
      "session-main.jsonl",
    );
    const miaSessionFile = path.join(
      openclawDir,
      "agents",
      "mia",
      "sessions",
      "session-mia.jsonl",
    );

    writeTranscript(mainSessionFile, [
      {
        type: "message",
        message: {
          role: "user",
          content: "Investigate the ACP dashboard",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Mapped the discord routing and started the dashboard build." },
            { type: "toolCall", name: "exec_command" },
          ],
          usage: {
            input: 120,
            output: 60,
            cacheRead: 10,
          },
        },
      },
    ]);

    writeTranscript(miaSessionFile, [
      {
        type: "message",
        message: {
          role: "user",
          content: "Review the design direction",
        },
      },
      {
        type: "message",
        message: {
          role: "assistant",
          content: "Captured a visual review and left comments.",
          usage: {
            input: 90,
            output: 40,
          },
        },
      },
    ]);

    writeJson(path.join(openclawDir, "agents", "main", "sessions", "sessions.json"), {
      "agent:main:discord:channel:123": {
        sessionId: "session-main",
        updatedAt: now - 2 * 60 * 1000,
        displayName: "discord:#pepper-space",
        channel: "discord",
        chatType: "channel",
        sessionFile: mainSessionFile,
        lastAccountId: "pepper",
        modelOverride: "gpt-5.4",
        providerOverride: "openai",
        skillsSnapshot: {
          skills: [{ name: "acp-router" }, { name: "coding-agent" }],
        },
      },
    });

    writeJson(path.join(openclawDir, "agents", "mia", "sessions", "sessions.json"), {
      "agent:mia:discord:channel:456": {
        sessionId: "session-mia",
        updatedAt: now - 25 * 60 * 1000,
        groupChannel: "#mia-space",
        channel: "discord",
        chatType: "channel",
        sessionFile: miaSessionFile,
        lastAccountId: "mia",
        skillsSnapshot: {
          skills: [{ name: "coding-agent" }],
        },
      },
    });

    writeJson(path.join(openclawDir, "agents", "main", "agent", "auth-profiles.json"), {
      profiles: {
        "openai-codex:default": {
          provider: "openai-codex",
          type: "oauth",
        },
      },
      lastGood: {
        "openai-codex": "openai-codex:default",
      },
      usageStats: {
        "openai-codex:default": {
          lastUsed: now - 30 * 1000,
        },
      },
    });

    writeJson(path.join(openclawDir, "agents", "mia", "agent", "auth-profiles.json"), {
      profiles: {
        "zai:default": {
          provider: "zai",
          type: "api_key",
        },
      },
      usageStats: {
        "zai:default": {
          lastUsed: now - 5 * 60 * 1000,
        },
      },
    });

    writeJson(path.join(openclawDir, "agents", "main", "agent", "models.json"), {
      providers: {
        openai: {
          models: [{ id: "gpt-5.4", name: "GPT-5.4", contextWindow: 272000 }],
        },
      },
    });

    writeJson(path.join(openclawDir, "agents", "mia", "agent", "models.json"), {
      providers: {
        zai: {
          models: [{ id: "glm-5", name: "GLM-5", contextWindow: 204800 }],
        },
      },
    });

    const acp = createAcpModule({
      getOpenClawDir: () => openclawDir,
      runOpenClaw: (command) => {
        if (command === "agents list --json") {
          return JSON.stringify(agentsList);
        }
        if (command === "agents bindings --json") {
          return JSON.stringify(bindings);
        }
        return null;
      },
      extractJSON: (value) => value,
      parseSessionLabel: (sessionKey) => `label:${sessionKey}`,
    });

    const activity = acp.getAgentActivity();

    assert.strictEqual(activity.summary.totalAgents, 2);
    assert.strictEqual(activity.summary.activeAgents, 1);
    assert.strictEqual(activity.summary.recentAgents, 1);
    assert.strictEqual(activity.summary.totalBindings, 2);
    assert.strictEqual(activity.summary.totalSessions, 2);
    assert.strictEqual(activity.summary.activeSessions, 1);
    assert.strictEqual(activity.summary.recentSessions, 1);
    assert.strictEqual(activity.summary.totalMessages, 4);
    assert.strictEqual(activity.summary.totalToolCalls, 1);
    assert.strictEqual(activity.summary.totalTokens, 320);

    assert.deepStrictEqual(
      activity.summary.channels.map((entry) => [entry.key, entry.count]),
      [["discord", 2]],
    );
    assert.ok(
      activity.summary.skills.some((entry) => entry.key === "coding-agent" && entry.count === 2),
    );

    const mainAgent = activity.agents.find((agent) => agent.id === "main");
    assert.ok(mainAgent);
    assert.strictEqual(mainAgent.activityState, "active");
    assert.strictEqual(mainAgent.bindings.length, 1);
    assert.strictEqual(mainAgent.stats.totalMessages, 2);
    assert.strictEqual(mainAgent.stats.totalToolCalls, 1);
    assert.strictEqual(mainAgent.stats.totalTokens, 190);
    assert.strictEqual(mainAgent.recentSessions[0].model, "openai/gpt-5.4");
    assert.match(mainAgent.recentSessions[0].preview, /dashboard build/i);
    assert.strictEqual(mainAgent.auth.providerCount, 1);
    assert.strictEqual(mainAgent.modelCatalog.modelCount, 1);

    const miaAgent = activity.agents.find((agent) => agent.id === "mia");
    assert.ok(miaAgent);
    assert.strictEqual(miaAgent.activityState, "recent");
    assert.strictEqual(miaAgent.stats.totalTokens, 130);
    assert.strictEqual(miaAgent.recentSessions[0].label, "#mia-space");

    assert.strictEqual(activity.recentSessions[0].agentId, "main");
    assert.strictEqual(activity.recentSessions[1].agentId, "mia");
  });
});
