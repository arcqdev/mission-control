const SUPPORTED_ACP_EVENTS = Object.freeze([
  "session_started",
  "turn_started",
  "turn_completed",
  "task_completed",
  "error",
  "stale_timeout",
  "abandoned",
]);

const TURN_SCOPED_EVENTS = new Set(["turn_started", "turn_completed"]);
const TASK_SCOPED_EVENTS = new Set(["task_completed"]);
const THREAD_UNAVAILABLE_ERROR_CODES = new Set([
  "THREAD_TARGET_UNAVAILABLE",
  "DISCORD_THREAD_UNAVAILABLE",
  "THREAD_NOT_FOUND",
  "UNKNOWN_THREAD",
  "CANNOT_MESSAGE_THREAD",
  "UNSUPPORTED_THREAD_TARGET",
]);

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  events: SUPPORTED_ACP_EVENTS,
  routing: {
    preferOriginThread: true,
    fallbackToOriginChannel: true,
    requireOriginAgentAccount: true,
  },
  sideEffects: {
    updateLinear: false,
    writeMissionControlCards: false,
    writeAuditLogs: false,
  },
  dedupe: {
    maxEntries: 1000,
  },
});

function normalizeLifecycleEventType(eventType) {
  if (!eventType) return null;

  const normalized = String(eventType)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (normalized === "stale" || normalized === "timeout" || normalized === "staletimeout") {
    return "stale_timeout";
  }

  return SUPPORTED_ACP_EVENTS.includes(normalized) ? normalized : null;
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function normalizeHookConfig(rawConfig = {}) {
  const routing = {
    ...DEFAULT_CONFIG.routing,
    ...(rawConfig.routing || {}),
  };

  const sideEffects = {
    updateLinear: false,
    writeMissionControlCards: false,
    writeAuditLogs: false,
  };

  const dedupe = {
    ...DEFAULT_CONFIG.dedupe,
    ...(rawConfig.dedupe || {}),
  };

  const configuredEvents = Array.isArray(rawConfig.events) ? rawConfig.events : DEFAULT_CONFIG.events;
  const events = configuredEvents.map(normalizeLifecycleEventType).filter(Boolean);

  return {
    enabled: rawConfig.enabled !== false,
    events: events.length ? events : [...DEFAULT_CONFIG.events],
    routing,
    sideEffects,
    dedupe: {
      maxEntries: Math.max(1, firstNumber(dedupe.maxEntries) || DEFAULT_CONFIG.dedupe.maxEntries),
    },
  };
}

function buildEventKey(event) {
  const eventType = normalizeLifecycleEventType(event?.type || event?.eventType);
  if (!eventType) return null;

  const sessionKey = firstString(
    event?.sessionKey,
    event?.session?.sessionKey,
    event?.session?.key,
    event?.context?.sessionKey,
    event?.sessionId,
    event?.session?.id,
  );

  if (!sessionKey) return null;

  const keyParts = [sessionKey];

  if (TURN_SCOPED_EVENTS.has(eventType)) {
    const turnId = firstString(
      event?.turnId,
      event?.turn?.id,
      event?.context?.turnId,
      event?.metadata?.turnId,
    );
    if (turnId) keyParts.push(turnId);
  }

  if (TASK_SCOPED_EVENTS.has(eventType)) {
    const taskId = firstString(
      event?.taskId,
      event?.task?.id,
      event?.context?.taskId,
      event?.metadata?.taskId,
    );
    if (taskId) keyParts.push(taskId);
  }

  keyParts.push(eventType);
  return keyParts.join(":");
}

function extractOriginRouteContext(event, runtimeContext = {}) {
  const sources = [event, runtimeContext, event?.context, event?.session, event?.origin, event?.discord];

  const accountId = firstString(
    event?.originAgentAccountId,
    event?.origin?.agentAccountId,
    event?.origin?.accountId,
    event?.session?.originAgentAccountId,
    event?.session?.origin?.agentAccountId,
    event?.discord?.accountId,
    event?.discord?.agentAccountId,
    runtimeContext?.originAgentAccountId,
    runtimeContext?.origin?.agentAccountId,
    runtimeContext?.origin?.accountId,
    runtimeContext?.discord?.accountId,
  );

  const threadId = firstString(
    event?.originThreadId,
    event?.origin?.threadId,
    event?.threadId,
    event?.session?.originThreadId,
    event?.session?.threadId,
    event?.session?.origin?.threadId,
    event?.discord?.threadId,
    runtimeContext?.originThreadId,
    runtimeContext?.origin?.threadId,
    runtimeContext?.threadId,
    runtimeContext?.discord?.threadId,
  );

  const channelId = firstString(
    event?.originChannelId,
    event?.origin?.channelId,
    event?.channelId,
    event?.session?.originChannelId,
    event?.session?.channelId,
    event?.session?.origin?.channelId,
    event?.discord?.channelId,
    runtimeContext?.originChannelId,
    runtimeContext?.origin?.channelId,
    runtimeContext?.channelId,
    runtimeContext?.discord?.channelId,
  );

  const routeContext = { accountId, threadId, channelId };

  for (const source of sources) {
    if (source?.discord?.parentChannelId && !routeContext.channelId) {
      routeContext.channelId = source.discord.parentChannelId;
    }
    if (source?.discord?.thread?.id && !routeContext.threadId) {
      routeContext.threadId = source.discord.thread.id;
    }
    if (source?.discord?.channel?.id && !routeContext.channelId) {
      routeContext.channelId = source.discord.channel.id;
    }
    if (source?.agent?.accountId && !routeContext.accountId) {
      routeContext.accountId = source.agent.accountId;
    }
  }

  return routeContext;
}

function resolveNotificationRoute(routeContext, config) {
  if (config.routing.requireOriginAgentAccount && !routeContext.accountId) {
    return {
      ok: false,
      reason: "missing_origin_agent_account",
    };
  }

  if (config.routing.preferOriginThread && routeContext.threadId) {
    return {
      ok: true,
      mode: "thread",
      accountId: routeContext.accountId,
      threadId: routeContext.threadId,
      channelId: routeContext.channelId,
    };
  }

  if (config.routing.fallbackToOriginChannel && routeContext.channelId) {
    return {
      ok: true,
      mode: "channel",
      accountId: routeContext.accountId,
      channelId: routeContext.channelId,
      threadId: null,
    };
  }

  return {
    ok: false,
    reason: routeContext.threadId ? "missing_origin_channel" : "missing_origin_route",
  };
}

function defaultFormatMessage({ eventType, event }) {
  const sessionLabel = firstString(
    event?.session?.label,
    event?.sessionLabel,
    event?.session?.sessionKey,
    event?.sessionKey,
    event?.session?.id,
    event?.sessionId,
    "unknown-session",
  );

  const turnLabel = firstString(event?.turn?.label, event?.turnLabel, event?.turnId, event?.turn?.id);
  const taskLabel = firstString(event?.task?.label, event?.taskLabel, event?.taskId, event?.task?.id);
  const errorMessage = firstString(
    event?.error?.message,
    event?.message,
    event?.details,
    event?.errorMessage,
  );

  switch (eventType) {
    case "session_started":
      return `ACP session started · ${sessionLabel}`;
    case "turn_started":
      return turnLabel
        ? `ACP turn started · ${sessionLabel} · ${turnLabel}`
        : `ACP turn started · ${sessionLabel}`;
    case "turn_completed":
      return turnLabel
        ? `ACP turn completed · ${sessionLabel} · ${turnLabel}`
        : `ACP turn completed · ${sessionLabel}`;
    case "task_completed":
      return taskLabel
        ? `ACP task completed · ${sessionLabel} · ${taskLabel}`
        : `ACP task completed · ${sessionLabel}`;
    case "error":
      return errorMessage
        ? `ACP error · ${sessionLabel} · ${errorMessage}`
        : `ACP error · ${sessionLabel}`;
    case "stale_timeout":
      return `ACP stale timeout · ${sessionLabel}`;
    case "abandoned":
      return `ACP abandoned · ${sessionLabel}`;
    default:
      return `ACP lifecycle update · ${sessionLabel}`;
  }
}

function createRuntimeDedupeStore(maxEntries) {
  const seen = new Map();

  return {
    has(eventKey) {
      return seen.has(eventKey);
    },
    add(eventKey) {
      if (seen.has(eventKey)) {
        seen.delete(eventKey);
      }
      seen.set(eventKey, Date.now());
      if (seen.size > maxEntries) {
        const oldestKey = seen.keys().next().value;
        if (oldestKey) seen.delete(oldestKey);
      }
    },
    size() {
      return seen.size;
    },
  };
}

function createLogger(logger = console) {
  return {
    info(message, metadata) {
      if (typeof logger.info === "function") logger.info(message, metadata);
    },
    warn(message, metadata) {
      if (typeof logger.warn === "function") logger.warn(message, metadata);
    },
    error(message, metadata) {
      if (typeof logger.error === "function") logger.error(message, metadata);
    },
  };
}

function serializeError(error) {
  if (!error) return { message: "Unknown error" };

  return {
    message: error.message,
    code: error.code,
    name: error.name,
  };
}

function shouldFallbackToChannel(error) {
  if (!error) return false;
  if (error.fallbackToChannel === true) return true;
  if (error.code && THREAD_UNAVAILABLE_ERROR_CODES.has(error.code)) return true;

  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  return message.includes("thread") && (message.includes("unavailable") || message.includes("not found"));
}

async function sendDiscordMessage(discordTransport, request) {
  if (typeof discordTransport?.send === "function") {
    return discordTransport.send(request);
  }

  if (request.mode === "thread" && typeof discordTransport?.replyInThread === "function") {
    return discordTransport.replyInThread(request);
  }

  if (request.mode === "channel" && typeof discordTransport?.sendToChannel === "function") {
    return discordTransport.sendToChannel(request);
  }

  throw new Error("Discord transport does not expose a compatible send function");
}

function createAcpDiscordLifecycleHook(options = {}) {
  const config = normalizeHookConfig(options.config || options);
  const logger = createLogger(options.logger);
  const discordTransport = options.discordTransport;
  const formatMessage = options.formatMessage || defaultFormatMessage;
  const dedupeStore = options.dedupeStore || createRuntimeDedupeStore(config.dedupe.maxEntries);

  if (!discordTransport) {
    throw new Error("createAcpDiscordLifecycleHook requires a discordTransport");
  }

  async function handleNormalizedEvent(eventType, payload = {}, runtimeContext = {}) {
    if (!config.enabled) {
      return {
        ok: true,
        skipped: true,
        reason: "hook_disabled",
      };
    }

    if (!config.events.includes(eventType)) {
      return {
        ok: true,
        skipped: true,
        reason: "event_not_enabled",
      };
    }

    const event = {
      ...payload,
      type: eventType,
      context: payload.context || runtimeContext,
    };

    const eventKey = buildEventKey(event);
    if (!eventKey) {
      logger.error("[ACP Discord Hook] Missing lifecycle identifiers", {
        eventType,
        sessionKey: payload?.sessionKey || payload?.session?.sessionKey || null,
      });
      return {
        ok: false,
        skipped: true,
        reason: "missing_event_key",
      };
    }

    if (dedupeStore.has(eventKey)) {
      return {
        ok: true,
        deduped: true,
        eventKey,
      };
    }

    const routeContext = extractOriginRouteContext(event, runtimeContext);
    const route = resolveNotificationRoute(routeContext, config);

    if (!route.ok) {
      logger.warn("[ACP Discord Hook] Skipping lifecycle event without routable Discord context", {
        eventKey,
        eventType,
        reason: route.reason,
      });
      return {
        ok: false,
        skipped: true,
        eventKey,
        reason: route.reason,
      };
    }

    const content = formatMessage({
      eventType,
      event,
      eventKey,
      route,
    });

    const request = {
      mode: route.mode,
      accountId: route.accountId,
      channelId: route.channelId,
      threadId: route.threadId,
      eventKey,
      eventType,
      content,
      metadata: {
        sessionKey: firstString(event?.sessionKey, event?.session?.sessionKey, event?.sessionId),
        turnId: firstString(event?.turnId, event?.turn?.id),
        taskId: firstString(event?.taskId, event?.task?.id),
      },
    };

    try {
      const delivery = await sendDiscordMessage(discordTransport, request);
      dedupeStore.add(eventKey);
      logger.info("[ACP Discord Hook] Delivered lifecycle event", {
        eventKey,
        eventType,
        route: request.mode,
      });
      return {
        ok: true,
        eventKey,
        route: request.mode,
        delivery,
      };
    } catch (error) {
      if (
        request.mode === "thread" &&
        config.routing.fallbackToOriginChannel &&
        route.channelId &&
        shouldFallbackToChannel(error)
      ) {
        const fallbackRequest = {
          ...request,
          mode: "channel",
          threadId: null,
        };

        logger.warn("[ACP Discord Hook] Thread delivery unavailable; falling back to parent channel", {
          eventKey,
          eventType,
          channelId: route.channelId,
          error: serializeError(error),
        });

        try {
          const delivery = await sendDiscordMessage(discordTransport, fallbackRequest);
          dedupeStore.add(eventKey);
          logger.info("[ACP Discord Hook] Delivered lifecycle event via channel fallback", {
            eventKey,
            eventType,
            channelId: route.channelId,
          });
          return {
            ok: true,
            eventKey,
            route: "channel",
            fallback: true,
            delivery,
          };
        } catch (fallbackError) {
          logger.error("[ACP Discord Hook] Channel fallback failed", {
            eventKey,
            eventType,
            error: serializeError(fallbackError),
          });
          return {
            ok: false,
            eventKey,
            error: serializeError(fallbackError),
          };
        }
      }

      logger.error("[ACP Discord Hook] Lifecycle delivery failed", {
        eventKey,
        eventType,
        error: serializeError(error),
      });
      return {
        ok: false,
        eventKey,
        error: serializeError(error),
      };
    }
  }

  async function handleEvent(eventOrType, payload, runtimeContext) {
    const eventType = normalizeLifecycleEventType(
      typeof eventOrType === "string" ? eventOrType : eventOrType?.type || eventOrType?.eventType,
    );

    if (!eventType) {
      logger.warn("[ACP Discord Hook] Ignoring unsupported lifecycle event", {
        eventType: typeof eventOrType === "string" ? eventOrType : eventOrType?.type || null,
      });
      return {
        ok: false,
        skipped: true,
        reason: "unsupported_event",
      };
    }

    const eventPayload = typeof eventOrType === "string" ? payload : eventOrType;
    return handleNormalizedEvent(eventType, eventPayload, runtimeContext);
  }

  const handlers = Object.fromEntries(
    SUPPORTED_ACP_EVENTS.map((eventType) => [
      eventType,
      async (payload, runtimeContext) => handleNormalizedEvent(eventType, payload, runtimeContext),
    ]),
  );

  return {
    name: "openclaw-command-center/acp-discord-lifecycle-hook",
    supportedEvents: [...SUPPORTED_ACP_EVENTS],
    config,
    handleEvent,
    handlers,
  };
}

function createGatewayPlugin(options = {}) {
  const hook = createAcpDiscordLifecycleHook(options);

  return {
    name: hook.name,
    supportedEvents: hook.supportedEvents,
    async onAcpLifecycleEvent(event, runtimeContext) {
      return hook.handleEvent(event, undefined, runtimeContext);
    },
    handlers: hook.handlers,
  };
}

module.exports = {
  DEFAULT_CONFIG,
  SUPPORTED_ACP_EVENTS,
  buildEventKey,
  createAcpDiscordLifecycleHook,
  createGatewayPlugin,
  defaultFormatMessage,
  extractOriginRouteContext,
  normalizeHookConfig,
  normalizeLifecycleEventType,
  resolveNotificationRoute,
  shouldFallbackToChannel,
};
