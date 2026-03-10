# Mission Control Foundation

## Purpose

Mission Control adds a durable backend foundation for cross-project operational state without changing existing operator UI behavior.

Phase 1 foundation covers:

- canonical tracked-project registry
- master-card domain model derived from Linear issues
- normalized risk / dispatch / status primitives
- profile-aware durable local persistence
- startup bootstrap from `src/index.js`

## Runtime Modules

Mission Control lives under `src/mission-control/`.

| Module        | Responsibility                                                            |
| ------------- | ------------------------------------------------------------------------- |
| `index.js`    | Bootstrap Mission Control at startup                                      |
| `registry.js` | Load and validate tracked projects, built-in agents, Discord destinations |
| `models.js`   | Normalize lanes, risk, dispatch, lifecycle, and master-card shapes        |
| `store.js`    | Atomic snapshot I/O, JSONL event log appends, replay, version guardrails  |

## Registry Contract

Mission Control reads server-side config from `CONFIG.missionControl`.

### Projects

Each project entry includes:

- `key`
- `repoPath`
- `linearProjectSlug`
- `lane`
- optional `symphonyPort`

### Agents

If no custom agent registry is configured, Mission Control seeds three built-in identities:

- `jon`
- `mia`
- `pepper`

### Discord destinations

Destination entries are loaded and validated but not yet used by any UI flow in this phase.

## Persistence Layout

Mission Control stores data under the existing profile-aware Command Center data root:

```text
~/.openclaw[-profile]/command-center/data/mission-control/
```

Files:

- `registry.snapshot.json`
- `cards.snapshot.json`
- `card-events.jsonl`

## Durability Model

### Snapshots

Snapshot writes use:

1. JSON serialization with stable key ordering
2. temp-file write
3. file `fsync`
4. atomic rename into place
5. best-effort parent-directory `fsync`

This keeps the current-state files resistant to partial writes during process interruption.

### Event log

Card events append to JSONL with:

- schema version marker
- sequence number
- event timestamp
- event payload
- file `fsync` after append

The event log serves both auditability and replay.

## Replay and Recovery

On startup, the store:

1. reads the latest registry snapshot
2. reads the latest cards snapshot
3. reads the event log
4. replays only events newer than each snapshot's `lastEventSequence`

That allows the process to recover state after a restart even if events were written after the last snapshot.

## Version Guardrails

All Mission Control persisted data uses `schemaVersion: 1`.

Rules:

- legacy snapshots without `schemaVersion` are migrated into the current envelope on read
- snapshots or events with a future schema version are rejected
- snapshot `kind` is validated to prevent cross-file misuse

## Startup Behavior

`src/index.js` initializes Mission Control during server startup.

Bootstrap is intentionally side-effect-limited:

- it creates/loads Mission Control storage
- it persists registry state when needed
- it does not change current UI routes or payloads
- it fails closed and logs an error if registry validation fails

## Test Coverage

Mission Control unit coverage currently verifies:

- registry normalization
- master-card derivation
- status precedence
- safe bootstrap failure on invalid registry config
- atomic snapshot creation and overwrite behavior
- replay correctness after restart
- legacy snapshot migration
- future schema-version rejection

## Non-Goals in This Slice

This foundation does not yet add:

- Mission Control UI routes or pages
- Linear polling/webhook sync
- Symphony monitoring probes
- operator write APIs
- Discord notification delivery
