const crypto = require("crypto");
const { createLinearClient, normalizeIssue } = require("./client");
const { createLinearSyncStore } = require("./store");

function isoNow(now) {
  return new Date(now()).toISOString();
}

function maxTimestamp(left, right) {
  if (!left) return right || null;
  if (!right) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function subtractMilliseconds(isoValue, amount) {
  if (!isoValue) return null;
  return new Date(Date.parse(isoValue) - amount).toISOString();
}

function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const normalizedSignature = signature.replace(/^sha256=/, "").trim();
  const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = Buffer.from(normalizedSignature);
  const expected = Buffer.from(expectedSignature);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function isFreshTimestamp(timestamp, now, maxAgeMs = 5 * 60 * 1000) {
  if (!timestamp) return true;
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) return false;
  return Math.abs(now() - parsed) <= maxAgeMs;
}

function normalizeWebhookIssue(payload) {
  const issueLike = payload?.data || payload?.issue || null;
  if (!issueLike?.id || !issueLike?.identifier) {
    return null;
  }
  return normalizeIssue(issueLike);
}

function createLinearSyncEngine({
  config,
  dataDir,
  client,
  now = Date.now,
  logger = console,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  onStateChange = () => {},
}) {
  const linearClient = client || createLinearClient({ apiKey: config.apiKey });
  const store = createLinearSyncStore({
    dataDir,
    now,
    pollIntervalMs: config.syncIntervalMs,
    projectSlugs: config.projectSlugs,
    webhook: {
      enabled: Boolean(config.webhookSecret),
      path: config.webhookPath,
    },
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
      store.updateSync({
        status: "disabled",
        lastReason: reason,
        lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
      });
      return getPublicState();
    }

    if (reconcilePromise) {
      return reconcilePromise;
    }

    reconcilePromise = (async () => {
      const attemptAt = isoNow(now);
      const priorCursor = store.getSnapshot().sync.cursor?.updatedAfter || null;
      const updatedAfter = subtractMilliseconds(priorCursor, config.reconcileOverlapMs || 0);

      store.updateSync({
        status: "syncing",
        lastAttemptedAt: attemptAt,
        lastReason: reason,
        lastError: null,
      });

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

        store.updateSync({
          status: "ok",
          cursor: {
            updatedAfter: cursor || priorCursor || attemptAt,
          },
          lastSuccessfulAt: isoNow(now),
          lastError: null,
          lastFetchedCount: remoteIssues.length,
          lastChangedCount: changedCount,
        });
      } catch (error) {
        store.updateSync({
          status: "error",
          lastError: error.message,
        });
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
      return {
        statusCode: 401,
        body: { error: "Invalid Linear webhook signature" },
      };
    }

    let payload;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch (error) {
      return {
        statusCode: 400,
        body: { error: `Invalid JSON body: ${error.message}` },
      };
    }

    if (!isFreshTimestamp(payload.webhookTimestamp, now)) {
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

    if (deliveryId && store.hasSeenWebhookDelivery(deliveryId)) {
      store.noteWebhookDelivery({ deliveryId, receivedAt: isoNow(now) });
      return {
        statusCode: 200,
        body: { ok: true, duplicate: true },
      };
    }

    const issue = normalizeWebhookIssue(payload);
    const belongsToConfiguredProject =
      !issue?.project?.slug || config.projectSlugs.includes(issue.project.slug);

    store.noteWebhookDelivery({ deliveryId, receivedAt: isoNow(now) });

    let changed = false;
    if (issue && belongsToConfiguredProject) {
      const result = store.upsertCard(issue, {
        source: "webhook",
        deliveryId,
        receivedAt: isoNow(now),
      });
      changed = result.changed;
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
        store.updateSync({
          status: "disabled",
          lastError: config.apiKey ? "No Linear project slugs configured" : "Linear sync disabled",
        });
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
    start,
    stop,
    reconcile,
    handleWebhook,
    getPublicState,
    getWebhookPath: () => config.webhookPath,
    isEnabled,
  };
}

module.exports = {
  createLinearSyncEngine,
  verifySignature,
  isFreshTimestamp,
  normalizeWebhookIssue,
};
