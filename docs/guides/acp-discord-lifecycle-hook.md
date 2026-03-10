# ACP Discord Lifecycle Hook

> _"The Overmind whispers in the same thread that spawned the Drone."_

This guide covers the custom OpenClaw ACP Discord lifecycle hook shipped in `src/acp-discord-lifecycle-hook.js`.

## What It Does

The hook emits deterministic ACP lifecycle notifications for these gateway events:

- `session_started`
- `turn_started`
- `turn_completed`
- `task_completed`
- `error`
- `stale_timeout`
- `abandoned`

Behavioral guarantees:

- routes with the originating Discord agent/account when present
- prefers the originating Discord thread
- falls back to the originating parent channel when thread targeting is unavailable
- does **not** mutate Linear
- does **not** mutate Mission Control board state
- does **not** write audit-log entries
- logs failures without crashing the gateway flow

## Runtime Contract

The hook expects the ACP lifecycle payload or runtime context to provide enough Discord origin metadata to route the notification:

- `originAgentAccountId` or `origin.agentAccountId`
- `originThreadId` or `origin.threadId`
- `originChannelId` or `origin.channelId`
- `sessionKey` (or `session.sessionKey` / `sessionId`) for deterministic event keys
- `turnId` for turn-scoped events
- `taskId` for task-scoped events

Representative lifecycle payload:

```js
{
  type: "turn_completed",
  sessionKey: "acp:discord:session-42",
  turnId: "turn-7",
  originAgentAccountId: "main-discord",
  originThreadId: "1245333222111",
  originChannelId: "1245000000000"
}
```

## Install

1. Install or update the `openclaw-command-center` skill/package on the gateway host.
2. Ensure the gateway runtime can `require()` the hook file at `src/acp-discord-lifecycle-hook.js`.
3. Register the hook/plugin with the ACP lifecycle callback surface in the OpenClaw gateway profile.
4. Restart or reload the target gateway profile.

Because OpenClaw gateway plugin registration can vary by runtime version, use the exported `createGatewayPlugin()` or `createAcpDiscordLifecycleHook()` factory that best matches the local gateway API.

## Config

Representative gateway-side configuration contract:

```yaml
discord:
  acpLifecycleHook:
    enabled: true
    events:
      - session_started
      - turn_started
      - turn_completed
      - task_completed
      - error
      - stale_timeout
      - abandoned
    routing:
      preferOriginThread: true
      fallbackToOriginChannel: true
      requireOriginAgentAccount: true
    sideEffects:
      updateLinear: false
      writeMissionControlCards: false
      writeAuditLogs: false
```

## Registration Example

```js
const {
  createGatewayPlugin,
} = require("/opt/openclaw-command-center/src/acp-discord-lifecycle-hook");

module.exports = createGatewayPlugin({
  config: {
    enabled: true,
    routing: {
      preferOriginThread: true,
      fallbackToOriginChannel: true,
      requireOriginAgentAccount: true,
    },
  },
  logger: console,
  discordTransport: {
    async send(request) {
      return gateway.discord.sendLifecycleMessage(request);
    },
  },
});
```

The transport contract is intentionally small:

- `accountId` identifies the originating Discord agent/account
- `threadId` is used when `mode === "thread"`
- `channelId` is used when `mode === "channel"`
- `content` is the deterministic lifecycle message body
- `eventKey` is the runtime dedupe key

Example artifacts are included here for copy/paste deployment:

- plugin wrapper: `docs/examples/acp-discord-lifecycle-hook.plugin.cjs`
- gateway config example: `docs/examples/acp-discord-lifecycle-hook.yaml`

## Rollout Runbook

1. Deploy the updated package to one Discord-enabled gateway profile.
2. Register the hook against ACP lifecycle events only.
3. Confirm the gateway is passing origin account, thread, and channel metadata into the hook.
4. Run a controlled ACP session started from a Discord thread.
5. Verify these notifications arrive once each in the same thread:
   - `session_started`
   - `turn_started`
   - `turn_completed`
   - `task_completed`
6. Trigger an `error` path and confirm the notification stays in-thread.
7. Simulate thread targeting loss and confirm the hook falls back to the same parent channel.
8. Simulate a stale or abandoned session and confirm a single `stale_timeout` or `abandoned` post.
9. Review gateway logs for any `[ACP Discord Hook]` warnings or errors.
10. Expand rollout to additional Discord agent/accounts after the canary passes.

## Example Files

If you want a ready-to-adapt starting point, copy these files into the target gateway runtime and adjust the local transport integration:

```bash
cp docs/examples/acp-discord-lifecycle-hook.plugin.cjs /opt/openclaw/plugins/acp-discord-lifecycle-hook.cjs
cp docs/examples/acp-discord-lifecycle-hook.yaml /etc/openclaw/acp-discord-lifecycle-hook.yaml
```

## Verification Checklist

Use this checklist during rollout:

- thread-capable sessions post to the originating thread
- thread-unavailable sessions fall back to the originating parent channel
- the message is sent with the same Discord agent/account that originated the ACP session
- duplicate lifecycle callbacks do not resend inside a single runtime
- hook failures stay observable in logs and do not interrupt ACP execution
- no Linear update or Mission Control mutation occurs

## Observability

The hook logs with an `[ACP Discord Hook]` prefix for:

- skipped events with missing routing metadata
- thread fallback activations
- delivery failures
- successful deliveries

A failing send returns an error object to the caller, but the hook catches transport exceptions so the gateway flow can continue.

## Rollback

1. Disable `discord.acpLifecycleHook.enabled` in the gateway profile.
2. Remove the ACP lifecycle hook registration from the gateway plugin list.
3. Reload or restart the gateway.
4. Re-run one ACP session to confirm lifecycle messages stop.
5. Leave Mission Control and Linear configuration unchanged; this hook has no board-state responsibilities.

## Source Files

- Hook implementation: `src/acp-discord-lifecycle-hook.js`
- Unit tests: `tests/acp-discord-lifecycle-hook.test.js`
