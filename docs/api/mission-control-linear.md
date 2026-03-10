# Mission Control Linear Sync API

## Overview

Mission Control keeps Linear issue state in a local master-card snapshot using a hybrid sync model:

- a mandatory 2-minute reconciliation poller for eventual correctness
- an optional signed webhook fast-path for low-latency updates

Snapshot and event-log files are persisted under the profile-aware Command Center data directory:

- `mission-control/linear-sync-snapshot.json`
- `mission-control/linear-sync-events.jsonl`

## Endpoints

### `GET /api/mission-control`

Returns the current Mission Control Linear materialization.

Response shape:

- `masterCards`: normalized Linear issue cards
- `stats.totalCards`: number of materialized cards
- `stats.eventCount`: number of persisted card-upsert events
- `sync`: reconciliation metadata, including cursor, lag, last error, and webhook delivery info

### `POST /api/integrations/linear/webhook`

Optional webhook acceleration endpoint.

Behavior:

- validates `linear-signature` using the configured webhook secret
- rejects stale payloads
- deduplicates repeated deliveries via `linear-delivery`
- applies a fast-path upsert, then schedules an immediate reconcile

## Configuration

Set via environment variables or `config/dashboard*.json`:

- `LINEAR_API_KEY`
- `LINEAR_PROJECT_SLUGS` — comma-separated project slugs
- `LINEAR_SYNC_INTERVAL_MS` — defaults to `120000`
- `LINEAR_RECONCILE_OVERLAP_MS` — defaults to `300000`
- `LINEAR_WEBHOOK_PATH` — defaults to `/api/integrations/linear/webhook`
- `LINEAR_WEBHOOK_SECRET`
