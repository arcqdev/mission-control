# Mission Control API

Mission Control exposes the Linear-backed operational board through stable REST APIs under `/api/mission-control/*` and live deltas over the existing `/api/events` SSE stream.

## REST endpoints

### `GET /api/mission-control`

Returns the raw Mission Control snapshot that powers the derived board, filter, health, and sync payloads. Consumers that need a stable operator-facing contract should prefer the specialized endpoints below.

### `GET /api/mission-control/board`

Returns the current materialized Mission Control board.

Response shape:

- `version` — response schema version
- `generatedAt` — response generation time
- `updatedAt` — last Mission Control snapshot update time
- `masterCards` — normalized card records
- `stats` — board counts (`totalCards`, `eventCount`, `projectCount`, `teamCount`, `stateCount`, `assigneeCount`)
- `sync` — current sync metadata and lag summary

### `GET /api/mission-control/filters`

Returns derived filter metadata for the current board.

Response shape:

- `filters.projects`
- `filters.teams`
- `filters.lanes`
- `filters.states`
- `filters.assignees`
- `filters.responsibleAgents`
- `filters.risks`
- `filters.dispatch`
- `filters.labels`
- `filters.priorities`
- `filters.estimates`
- `filters.cycles`

Each filter option includes a stable key/label pair plus a `count`.

### `GET /api/mission-control/health`

Returns a health summary for operators.

Response shape:

- `health.status` — `ok`, `degraded`, `stale`, `disabled`, or `error`
- `health.summary` — human-readable summary
- `health.counts` — summarized board counts
- `health.sync` — lag/error details used to derive the status

### `GET /api/mission-control/sync`

Returns sync status and lag metadata.

Response shape:

- `enabled`
- `sync.status`
- `sync.lastAttemptedAt`
- `sync.lastSuccessfulAt`
- `sync.lastWebhookAt`
- `sync.lastError`
- `sync.lastReason`
- `sync.lag`
- `sync.webhook`
- `stats`

### `GET /api/mission-control/admin/status`

Returns operator-facing status for sync plus SSE replay metadata.

Response shape:

- `enabled`
- `sse.clientCount`
- `sse.lastReplayAt`
- `sse.lastMissionControlEventAt`
- `stats`
- `sync`
- `health`

### `POST /api/mission-control/reconcile`

Triggers the same safe full refresh used by the admin reconcile flow and returns the refreshed public Mission Control snapshot.

### `POST /api/mission-control/admin/reconcile`

Triggers a safe manual reconcile without restarting the server.

Response shape:

- `ok`
- `triggeredAt`
- `board`
- `sync`

### `POST /api/mission-control/admin/replay`

Replays the current Mission Control board onto active SSE clients.

Response shape:

- `ok`
- `replayedAt`
- `sseClientCount`
- `board`
- `sync`

## SSE contract

Mission Control reuses `GET /api/events` and emits a custom `mission-control` event.

Payload shape:

- `version`
- `emittedAt`
- `type` — `card-upserted`, `sync-updated`, `webhook-delivery`, `runtime-updated`, or `replay`
- `stats`
- `sync`
- `delta` — present for card/sync/webhook/runtime updates
- `board` — present for `replay`

This keeps the existing dashboard SSE channel intact while allowing Mission Control consumers to subscribe only to Mission Control deltas.

## Auth posture

Mission Control REST/admin endpoints and the shared `GET /api/events` stream follow the standard Command Center auth gate.
Only the optional Linear webhook path is added to `auth.publicPaths` when `LINEAR_WEBHOOK_SECRET` is configured.
