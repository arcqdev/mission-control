const crypto = require("crypto");

const { createLinearClient } = require("./client");
const { createLinearSyncStore } = require("./store");

function isoNow(now = Date.now) {
  return new Date(now()).toISOString();
}

function maxTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left || null;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function subtractMilliseconds(timestamp, amountMs) {
  if (!timestamp) return null;
  return new Date(Date.parse(timestamp) - amountMs).toISOString();
}

function verifySignature(body, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(String(signature));

  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function isFreshTimestamp(timestamp, now = Date.now, maxAgeMs = 5 * 60 * 1000) {
  if (!timestamp) return false;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(now() - parsed) <= maxAgeMs;
}

function normalizeWebhookIssue(payload) {
  const issue = payload?.data || payload?.issue || payload;
  if (!issue || typeof issue !== "object") {
    return null;
  }

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title || "Untitled",
    description: issue.description || "",
    url: issue.url || null,
    priority: issue.priority ?? null,
    estimate: issue.estimate ?? null,
    createdAt: issue.createdAt || null,
    updatedAt: issue.updatedAt || payload?.webhookTimestamp || null,
    startedAt: issue.startedAt || null,
    completedAt: issue.completedAt || null,
    canceledAt: issue.canceledAt || null,
    archivedAt: issue.archivedAt || null,
    state: issue.state
      ? {
          id: issue.state.id || null,
          name: issue.state.name || null,
          type: issue.state.type || null,
          color: issue.state.color || null,
        }
      : null,
    project: issue.project
      ? {
          id: issue.project.id || null,
          name: issue.project.name || null,
          slug: issue.project.slug || null,
          progress: issue.project.progress ?? null,
        }
      : null,
    team: issue.team
      ? {
          id: issue.team.id || null,
          key: issue.team.key || null,
          name: issue.team.name || null,
        }
      : null,
    assignee: issue.assignee
      ? {
          id: issue.assignee.id || null,
          name: issue.assignee.name || null,
          email: issue.assignee.email || null,
        }
      : null,
    labels: Array.isArray(issue.labels)
      ? issue.labels.map((label) => ({
          id: label.id || null,
          name: label.name || null,
          color: label.color || null,
        }))
      : Array.isArray(issue.labels?.nodes)
        ? issue.labels.nodes.map((label) => ({
            id: label.id || null,
            name: label.name || null,
            color: label.color || null,
          }))
        : [],
    cycle: issue.cycle
      ? {
          id: issue.cycle.id || null,
          number: issue.cycle.number ?? null,
          name: issue.cycle.name || null,
          startsAt: issue.cycle.startsAt || null,
          endsAt: issue.cycle.endsAt || null,
        }
      : null,
  };
}

function createLinearSyncEngine(options = {}) {
  const config = {
    enabled: Boolean(options.config?.enabled || options.config?.apiKey),
    apiKey: options.config?.apiKey || null,
    projectSlugs: options.config?.projectSlugs || [],
    syncIntervalMs: options.config?.syncIntervalMs || 120000,
    reconcileOverlapMs: options.config?.reconcileOverlapMs || 300000,
    webhookPath: options.config?.webhookPath || "/api/integrations/linear/webhook",
    webhookSecret: options.config?.webhookSecret || null,
  };

  const now = options.now || Date.now;
  const logger = options.logger || console;
  const setIntervalFn = options.setIntervalFn || setInterval;
  const clearIntervalFn = options.clearIntervalFn || clearInterval;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const onStateChange = options.onStateChange || (() => {});
  const linearClient = options.client || createLinearClient({ apiKey: config.apiKey });
  const store = createLinearSyncStore({
    dataDir: options.dataDir,
    now,
    pollIntervalMs: config.syncIntervalMs,
    projectSlugs: config.projectSlugs,
    webhook: {
      enabled: Boolean(config.webhookSecret),
      path: config.webhookPath,
    },
    registry: options.registry || null,
    onChange: onStateChange,
  });

  let pollHandle = null;
  let acceleratedHandle = null;
  let reconcilePromise = null;

  function isEnabled() {
    return Boolean(config.enabled && config.apiKey && config.projectSlugs.length > 0);
  }

  function getPublicState() {
    return store.getPublicState();
  }

  async function reconcile({ reason = "poll" } = {}) {
    if (!isEnabled()) {
      store.updateSync(
        {
          status: "disabled",
          lastReason: reason,
          lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
        },
        {
          type: "mission-control.linear.reconcile.skipped",
          source: reason,
          payload: {
            reason,
            error: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
          },
        },
      );
      return getPublicState();
    }

    if (reconcilePromise) {
      return reconcilePromise;
    }

    reconcilePromise = (async () => {
      const attemptAt = isoNow(now);
      const priorCursor = store.getSnapshot().sync.cursor?.updatedAfter || null;
      const updatedAfter = subtractMilliseconds(priorCursor, config.reconcileOverlapMs || 0);

      store.updateSync(
        {
          status: "syncing",
          lastAttemptedAt: attemptAt,
          lastReason: reason,
          lastError: null,
        },
        {
          type: "mission-control.linear.reconcile.started",
          source: reason,
          payload: {
            reason,
            updatedAfter,
          },
          occurredAt: attemptAt,
        },
      );

      try {
        const remoteIssues = await linearClient.fetchIssuesForProjects({
          projectSlugs: config.projectSlugs,
          updatedAfter,
        });

        let changedCount = 0;
        let cursor = priorCursor;
        for (const issue of remoteIssues) {
          const result = store.upsertCard(issue, {
            source: reason === "webhook" ? "webhook-reconcile" : "poller",
            receivedAt: attemptAt,
          });
          if (result.changed) {
            changedCount += 1;
          }
          cursor = maxTimestamp(cursor, issue.updatedAt);
        }

        store.updateSync(
          {
            status: "ok",
            cursor: {
              updatedAfter: cursor || priorCursor || attemptAt,
            },
            lastSuccessfulAt: isoNow(now),
            lastError: null,
            lastFetchedCount: remoteIssues.length,
            lastChangedCount: changedCount,
          },
          {
            type: "mission-control.linear.reconcile.completed",
            source: reason,
            payload: {
              reason,
              updatedAfter: cursor || priorCursor || attemptAt,
              fetchedCount: remoteIssues.length,
              changedCount,
            },
          },
        );
      } catch (error) {
        store.updateSync(
          {
            status: "error",
            lastError: error.message,
          },
          {
            type: "mission-control.linear.reconcile.failed",
            source: reason,
            payload: {
              reason,
              error: error.message,
            },
          },
        );
        logger.error("[Linear Sync] Reconcile failed:", error.message);
      } finally {
        reconcilePromise = null;
      }

      return getPublicState();
    })();

    return reconcilePromise;
  }

  function scheduleAcceleratedReconcile() {
    if (acceleratedHandle) return;
    acceleratedHandle = setTimeoutFn(() => {
      acceleratedHandle = null;
      reconcile({ reason: "webhook" }).catch((error) => {
        logger.error("[Linear Sync] Accelerated reconcile failed:", error.message);
      });
    }, 250);
  }

  async function handleWebhook({ headers = {}, rawBody = "" }) {
    if (!config.webhookSecret) {
      return {
        statusCode: 404,
        body: { error: "Linear webhook endpoint not configured" },
      };
    }

    const signature = headers["linear-signature"] || headers["Linear-Signature"];
    if (!verifySignature(rawBody, signature, config.webhookSecret)) {
      store.updateSync(
        {
          lastError: "Invalid Linear webhook signature",
        },
        {
          type: "mission-control.linear.webhook.rejected",
          source: "webhook",
          payload: {
            reason: "invalid-signature",
          },
        },
      );
      return {
        statusCode: 401,
        body: { error: "Invalid Linear webhook signature" },
      };
    }

    let payload;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      store.updateSync(
        {
          lastError: `Invalid JSON body: ${error.message}`,
        },
        {
          type: "mission-control.linear.webhook.rejected",
          source: "webhook",
          payload: {
            reason: "invalid-json",
            error: error.message,
          },
        },
      );
      return {
        statusCode: 400,
        body: { error: `Invalid JSON body: ${error.message}` },
      };
    }

    if (!isFreshTimestamp(payload.webhookTimestamp, now)) {
      store.updateSync(
        {
          lastError: "Stale Linear webhook payload",
        },
        {
          type: "mission-control.linear.webhook.rejected",
          source: "webhook",
          payload: {
            reason: "stale-payload",
          },
        },
      );
      return {
        statusCode: 401,
        body: { error: "Stale Linear webhook payload" },
      };
    }

    const deliveryId =
      headers["linear-delivery"] ||
      headers["Linear-Delivery"] ||
      payload.webhookId ||
      payload.id ||
      null;

    const issue = normalizeWebhookIssue(payload);

    if (deliveryId && store.hasSeenWebhookDelivery(deliveryId)) {
      store.noteWebhookDelivery({
        deliveryId,
        receivedAt: isoNow(now),
        issue,
        duplicate: true,
      });
      return {
        statusCode: 200,
        body: { ok: true, duplicate: true },
      };
    }

    const belongsToConfiguredProject =
      !issue?.project?.slug || config.projectSlugs.includes(issue.project.slug);

    store.noteWebhookDelivery({ deliveryId, receivedAt: isoNow(now), issue, duplicate: false });

    let changed = false;
    if (issue && belongsToConfiguredProject) {
      const result = store.upsertCard(issue, {
        source: "webhook",
        deliveryId,
        receivedAt: isoNow(now),
      });
      changed = result.changed;
    } else if (issue) {
      store.appendAuditEvent(
        "mission-control.linear.webhook.ignored",
        {
          reason: "project-not-configured",
          projectSlug: issue.project?.slug || null,
        },
        {
          occurredAt: isoNow(now),
          source: "webhook",
          cardId: issue.id ? `mc:${issue.id}` : null,
          issueId: issue.id || null,
          identifier: issue.identifier || null,
          deliveryId,
        },
      );
    }

    scheduleAcceleratedReconcile();

    return {
      statusCode: 202,
      body: {
        ok: true,
        duplicate: false,
        changed,
      },
    };
  }

  function start() {
    if (pollHandle || !isEnabled()) {
      if (!isEnabled()) {
        store.updateSync(
          {
            status: "disabled",
            lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
          },
          {
            type: "mission-control.linear.sync.disabled",
            payload: {
              error: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
            },
          },
        );
      }
      return;
    }

    reconcile({ reason: "startup" }).catch((error) => {
      logger.error("[Linear Sync] Startup reconcile failed:", error.message);
    });

    pollHandle = setIntervalFn(() => {
      reconcile({ reason: "poll" }).catch((error) => {
        logger.error("[Linear Sync] Poll reconcile failed:", error.message);
      });
    }, config.syncIntervalMs);
  }

  function stop() {
    if (pollHandle) {
      clearIntervalFn(pollHandle);
      pollHandle = null;
    }
    if (acceleratedHandle) {
      clearTimeoutFn(acceleratedHandle);
      acceleratedHandle = null;
    }
  }

  return {
    bootstrap: () => store.bootstrap(),
    start,
    stop,
    reconcile,
    handleWebhook,
    getPublicState,
    getTimelineForCard: (reference) => store.getTimelineForCard(reference),
    getEventLog: () => store.readEventLog(),
    getWebhookPath: () => config.webhookPath,
    isEnabled,
  };
}

module.exports = {
  createLinearSyncEngine,
  isFreshTimestamp,
  normalizeWebhookIssue,
  verifySignature,
};
