# Mission Control Runbook — Symphony Outage

## Trigger

Use this runbook when Jon-lane cards pile up, queue aging goes stale, or operators suspect Symphony execution has stopped or drifted.

## Immediate checks

1. Open the affected Jon-lane card in Mission Control.
2. Confirm whether the card is stale, blocked, or awaiting review.
3. Check Symphony process health and the relevant project port outside Mission Control.
4. Confirm queue aging reflects the expected downtime window.

## Recovery steps

1. Restore the Symphony process or restart the affected workspace.
2. Re-check the card timeline to confirm new updates arrive.
3. Trigger a manual reconcile if Linear was updated during the outage.
4. Move the card only after execution signals resume and queue aging begins recovering.

## Escalate when

- multiple Jon-lane cards show stale aging after restart
- manual reconcile clears poll lag but work still does not resume
- operators need to reassign execution out of Symphony temporarily
