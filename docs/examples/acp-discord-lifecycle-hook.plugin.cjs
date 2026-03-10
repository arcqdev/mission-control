const { createGatewayPlugin } = require("../../src/acp-discord-lifecycle-hook");

module.exports = function registerAcpDiscordLifecycleHook(gateway) {
  return createGatewayPlugin({
    config: {
      enabled: true,
      events: [
        "session_started",
        "turn_started",
        "turn_completed",
        "task_completed",
        "error",
        "stale_timeout",
        "abandoned",
      ],
      routing: {
        preferOriginThread: true,
        fallbackToOriginChannel: true,
        requireOriginAgentAccount: true,
      },
    },
    logger: console,
    discordTransport: {
      async send(request) {
        return gateway.discord.sendLifecycleMessage({
          accountId: request.accountId,
          channelId: request.channelId,
          threadId: request.threadId,
          content: request.content,
          metadata: {
            eventKey: request.eventKey,
            eventType: request.eventType,
            ...request.metadata,
          },
        });
      },
    },
  });
};
