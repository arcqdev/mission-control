const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  buildEventKey,
  createAcpDiscordLifecycleHook,
  extractOriginRouteContext,
  normalizeHookConfig,
  resolveNotificationRoute,
} = require("../src/acp-discord-lifecycle-hook");

function createLogger() {
  const entries = {
    info: [],
    warn: [],
    error: [],
  };

  return {
    entries,
    info(message, metadata) {
      entries.info.push({ message, metadata });
    },
    warn(message, metadata) {
      entries.warn.push({ message, metadata });
    },
    error(message, metadata) {
      entries.error.push({ message, metadata });
    },
  };
}

describe("acp discord lifecycle hook", () => {
  it("builds stable event keys across lifecycle scopes", () => {
    assert.strictEqual(
      buildEventKey({ type: "session_started", sessionKey: "session-42" }),
      "session-42:session_started",
    );

    assert.strictEqual(
      buildEventKey({ type: "turn_completed", sessionKey: "session-42", turnId: "turn-7" }),
      "session-42:turn-7:turn_completed",
    );

    assert.strictEqual(
      buildEventKey({ type: "task_completed", sessionKey: "session-42", taskId: "task-9" }),
      "session-42:task-9:task_completed",
    );
  });

  it("extracts routing metadata from nested discord session context", () => {
    const routeContext = extractOriginRouteContext({
      session: {
        origin: {
          agentAccountId: "main-discord",
          channelId: "channel-1",
          threadId: "thread-1",
        },
      },
    });

    assert.deepStrictEqual(routeContext, {
      accountId: "main-discord",
      channelId: "channel-1",
      threadId: "thread-1",
    });
  });

  it("prefers the origin thread when full routing context exists", () => {
    const route = resolveNotificationRoute(
      {
        accountId: "main-discord",
        channelId: "channel-1",
        threadId: "thread-1",
      },
      normalizeHookConfig({}),
    );

    assert.deepStrictEqual(route, {
      ok: true,
      accountId: "main-discord",
      channelId: "channel-1",
      mode: "thread",
      threadId: "thread-1",
    });
  });

  it("falls back to the parent channel when thread delivery is unavailable", async () => {
    const logger = createLogger();
    const requests = [];
    const discordTransport = {
      async send(request) {
        requests.push(request);
        if (request.mode === "thread") {
          const error = new Error("thread target unavailable");
          error.code = "THREAD_TARGET_UNAVAILABLE";
          throw error;
        }
        return { messageId: "message-2", route: request.mode };
      },
    };

    const hook = createAcpDiscordLifecycleHook({ logger, discordTransport });
    const result = await hook.handleEvent("turn_completed", {
      sessionKey: "session-42",
      turnId: "turn-7",
      originAgentAccountId: "main-discord",
      originChannelId: "channel-1",
      originThreadId: "thread-1",
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.fallback, true);
    assert.strictEqual(result.route, "channel");
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[0].mode, "thread");
    assert.strictEqual(requests[1].mode, "channel");
    assert.strictEqual(logger.entries.warn.length, 1);
  });

  it("skips cleanly when the origin agent account is missing", async () => {
    const logger = createLogger();
    let sendCalls = 0;
    const hook = createAcpDiscordLifecycleHook({
      logger,
      discordTransport: {
        async send() {
          sendCalls += 1;
          return { messageId: "should-not-send" };
        },
      },
    });

    const result = await hook.handleEvent("session_started", {
      sessionKey: "session-42",
      originChannelId: "channel-1",
      originThreadId: "thread-1",
    });

    assert.deepStrictEqual(result, {
      ok: false,
      skipped: true,
      eventKey: "session-42:session_started",
      reason: "missing_origin_agent_account",
    });
    assert.strictEqual(sendCalls, 0);
    assert.strictEqual(logger.entries.warn.length, 1);
  });

  it("does not crash the main flow when Discord delivery fails", async () => {
    const logger = createLogger();
    const hook = createAcpDiscordLifecycleHook({
      logger,
      discordTransport: {
        async send() {
          const error = new Error("discord outage");
          error.code = "DISCORD_DOWN";
          throw error;
        },
      },
    });

    const result = await hook.handleEvent("error", {
      sessionKey: "session-42",
      originAgentAccountId: "main-discord",
      originChannelId: "channel-1",
      error: { message: "context window exceeded" },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.eventKey, "session-42:error");
    assert.deepStrictEqual(result.error, {
      code: "DISCORD_DOWN",
      message: "discord outage",
      name: "Error",
    });
    assert.strictEqual(logger.entries.error.length, 1);
  });

  it("deduplicates repeat lifecycle sends within a runtime", async () => {
    const requests = [];
    const logger = createLogger();
    const hook = createAcpDiscordLifecycleHook({
      logger,
      discordTransport: {
        async send(request) {
          requests.push(request);
          return { messageId: "message-1" };
        },
      },
    });

    const payload = {
      sessionKey: "session-42",
      originAgentAccountId: "main-discord",
      originChannelId: "channel-1",
    };

    const first = await hook.handleEvent("session_started", payload);
    const second = await hook.handleEvent("session_started", payload);

    assert.strictEqual(first.ok, true);
    assert.deepStrictEqual(second, {
      ok: true,
      deduped: true,
      eventKey: "session-42:session_started",
    });
    assert.strictEqual(requests.length, 1);
  });

  it("forces side-effect mutators off even when misconfigured", () => {
    const config = normalizeHookConfig({
      sideEffects: {
        updateLinear: true,
        writeMissionControlCards: true,
        writeAuditLogs: true,
      },
    });

    assert.deepStrictEqual(config.sideEffects, {
      updateLinear: false,
      writeMissionControlCards: false,
      writeAuditLogs: false,
    });
  });
});
