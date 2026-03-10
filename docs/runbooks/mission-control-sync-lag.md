# Mission Control Runbook — Sync Lag

## Trigger

Use this runbook when Mission Control shows poll lag beyond two sync intervals, stale card counts rising, or a `poll` divergence signal.

## Immediate checks

1. Open Mission Control and confirm the current `sync.status`, `lastError`, and `lag` values.
2. Trigger a manual reconcile from the UI.
3. If reconcile fails, inspect Linear credentials (`LINEAR_API_KEY`) and project slug config.
4. Verify outbound network connectivity from the host to Linear.

## Recovery steps

1. Fix credential or connectivity issues.
2. Trigger another manual reconcile.
3. Confirm:
   - `sync.status` returns to `ok`
   - lag drops back under one poll interval
   - affected cards clear their `poll` divergence signal
4. If lag remains high, restart Command Center and repeat the reconcile.

## Escalate when

- reconcile continues failing for more than 15 minutes
- state write errors also appear
- operators cannot trust card freshness for active dispatching
