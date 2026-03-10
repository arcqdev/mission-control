---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: d5aa04f994e1
  assignee: me
  active_states:
    - Todo
    - In Progress
    - Rework
  terminal_states:
    - Done
    - Cancelled
    - Canceled
    - Duplicate

polling:
  interval_ms: 10000

workspace:
  root: /Users/eddie/dev/arcqdev/openclaw-command-center/.symphony/workspaces

agent:
  max_concurrent_agents: 2
  max_turns: 16

codex:
  approval_policy: never
  thread_sandbox: danger-full-access
  turn_sandbox_policy:
    type: dangerFullAccess

server:
  port: 45126

observability:
  dashboard_enabled: true
---

You are an autonomous developer working on openclaw-command-center.

Stack: Node.js backend + static frontend (npm).

## Your task

Linear issue:
- Identifier: {{ issue.identifier }}
- Title: {{ issue.title }}
- URL: {{ issue.url }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

## Execution protocol

1. Classify scope first: `backend`, `frontend`, `fullstack`, or `ops`.
2. Write a short plan in the workpad before editing.
3. Keep changes tightly scoped and production-safe.
4. Run validation before marking done:
   - `npm test`
5. If blocked for >20 min, comment blocker + options, move to Rework.

## Done criteria

- Changes committed and pushed
- Issue comment includes what changed + verification output
