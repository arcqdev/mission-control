# Mission Control Runbook — Webhook Outage

## Trigger

Use this runbook when cards show `webhook` divergence, duplicate or rejected webhook events spike, or webhook-driven freshness stops while polling still works.

## Immediate checks

1. Inspect the selected card timeline in Mission Control.
2. Confirm whether recent events show:
   - `webhook.received`
   - `webhook.duplicate`
   - `webhook.rejected`
3. Verify the configured Linear webhook endpoint path and secret.
4. Confirm the public endpoint is reachable from Linear.

## Recovery steps

1. Correct the webhook secret or endpoint routing if needed.
2. Re-deliver or recreate the Linear webhook subscription.
3. Trigger a manual reconcile so polling closes any missed changes.
4. Confirm a later poll or webhook-reconcile event clears the divergence signal.

## Notes

Mission Control treats polling as correctness authority. A webhook outage should degrade freshness, not correctness, once reconcile is healthy again.
