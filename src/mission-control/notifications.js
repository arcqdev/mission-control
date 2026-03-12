const { createMissionControlStore } = require("./store");
const {
  createEmptyNotificationsState,
  normalizeNotificationEvent,
  normalizeNotificationsConfig,
} = require("./models");

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) {
    return null;
  }

  const seconds = Number.parseFloat(headerValue);
  if (!Number.isNaN(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const parsedDate = Date.parse(headerValue);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(0, parsedDate - Date.now());
}

function getCategoryLabel(category) {
  return category === "exception" ? "Exception" : "Completion";
}

function getSeverityColor(severity) {
  switch (severity) {
    case "critical":
      return 0xf85149;
    case "warn":
      return 0xd29922;
    default:
      return 0x3fb950;
  }
}

function truncate(text, maxLength = 512) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createNotificationsModule(options) {
  const {
    config = {},
    dataDir,
    fetchImpl = global.fetch,
    now = () => Date.now(),
    sleep = defaultSleep,
    logger = console,
    onStateChange = () => {},
  } = options;

  if (!dataDir) {
    throw new Error("dataDir is required for Mission Control notifications");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetchImpl is required for Mission Control notifications");
  }

  const normalizedConfig = normalizeNotificationsConfig(config);
  const store = createMissionControlStore(dataDir);
  const persistedState = store.readNotifications(createEmptyNotificationsState());
  const state = {
    ...createEmptyNotificationsState(),
    ...persistedState,
    records: { ...(persistedState.records || {}) },
  };

  const inFlightDeliveries = new Map();

  function isoNow() {
    return new Date(now()).toISOString();
  }

  function saveState() {
    state.updatedAt = isoNow();
    store.writeNotifications(state);
    onStateChange(getState());
  }

  function redactRecord(record) {
    const destination = normalizedConfig.destinations[record.destinationKey];
    const sender = normalizedConfig.senders[record.senderKey];

    return {
      eventKey: record.eventKey,
      category: record.category,
      severity: record.severity,
      title: record.title,
      summary: record.summary,
      senderKey: record.senderKey,
      senderName: sender?.displayName || record.senderKey || null,
      destinationKey: record.destinationKey,
      destinationLabel: destination?.label || record.destinationKey || null,
      status: record.status,
      attempts: record.attempts,
      maxAttempts: record.maxAttempts,
      dedupeHits: record.dedupeHits || 0,
      deadLetter: Boolean(record.deadLetter),
      cardId: record.cardId,
      issueIdentifier: record.issueIdentifier,
      projectKey: record.projectKey,
      createdAt: record.createdAt,
      occurredAt: record.occurredAt,
      lastAttemptAt: record.lastAttemptAt || null,
      deliveredAt: record.deliveredAt || null,
      failedAt: record.failedAt || null,
      nextAttemptAt: record.nextAttemptAt || null,
      lastError: record.lastError || null,
    };
  }

  function listRecentRecords(limit = 10) {
    return Object.values(state.records)
      .sort((left, right) => {
        const leftTime = Date.parse(left.lastAttemptAt || left.createdAt || 0);
        const rightTime = Date.parse(right.lastAttemptAt || right.createdAt || 0);
        return rightTime - leftTime;
      })
      .slice(0, limit)
      .map((record) => redactRecord(record));
  }

  function buildAlertBanner(summary) {
    const { deadLetterCount, retryingCount, recentFailures } = summary;

    if (deadLetterCount > 0) {
      return {
        visible: true,
        severity: "critical",
        title: "Mission Control Discord delivery failures",
        message:
          deadLetterCount === 1
            ? "1 notification moved to dead-letter after exhausting retries."
            : `${deadLetterCount} notifications moved to dead-letter after exhausting retries.`,
        items: recentFailures.slice(0, 3).map((record) => ({
          title: record.title,
          message: record.lastError?.message || "Discord delivery failed",
        })),
      };
    }

    if (retryingCount > 0) {
      return {
        visible: true,
        severity: "warn",
        title: "Mission Control Discord retries in progress",
        message:
          retryingCount === 1
            ? "1 notification is retrying after a Discord delivery error."
            : `${retryingCount} notifications are retrying after Discord delivery errors.`,
        items: recentFailures.slice(0, 3).map((record) => ({
          title: record.title,
          message: record.lastError?.message || "Retry pending",
        })),
      };
    }

    return {
      visible: false,
      severity: null,
      title: null,
      message: null,
      items: [],
    };
  }

  function getState() {
    const records = Object.values(state.records);
    const summary = {
      queuedCount: records.filter((record) => record.status === "queued").length,
      retryingCount: records.filter((record) => record.status === "retrying").length,
      deliveredCount: records.filter((record) => record.status === "delivered").length,
      failedCount: records.filter((record) => record.status === "failed").length,
      deadLetterCount: records.filter((record) => record.deadLetter).length,
      recentFailures: records
        .filter((record) => record.status === "failed" || record.status === "retrying")
        .sort((left, right) => {
          const leftTime = Date.parse(left.lastAttemptAt || left.createdAt || 0);
          const rightTime = Date.parse(right.lastAttemptAt || right.createdAt || 0);
          return rightTime - leftTime;
        }),
    };

    return {
      enabled: normalizedConfig.enabled,
      configSummary: {
        destinationCount: Object.keys(normalizedConfig.destinations).length,
        senderCount: Object.keys(normalizedConfig.senders).length,
        destinations: Object.values(normalizedConfig.destinations).map((destination) => ({
          key: destination.key,
          label: destination.label,
          allowedSenders: destination.allowedSenders,
        })),
        senders: Object.values(normalizedConfig.senders).map((sender) => ({
          key: sender.key,
          displayName: sender.displayName,
          defaultDestinationKey: sender.defaultDestinationKey,
        })),
      },
      delivery: {
        queuedCount: summary.queuedCount,
        retryingCount: summary.retryingCount,
        deliveredCount: summary.deliveredCount,
        failedCount: summary.failedCount,
        deadLetterCount: summary.deadLetterCount,
        lastSuccessAt: state.lastSuccessAt,
        lastErrorAt: state.lastErrorAt,
        recent: listRecentRecords(),
      },
      alertBanner: buildAlertBanner(summary),
      updatedAt: state.updatedAt,
    };
  }

  function computeDelayMs(record, retryAfterMs) {
    if (retryAfterMs !== null && retryAfterMs !== undefined) {
      return Math.min(normalizedConfig.retry.maxDelayMs, Math.max(0, retryAfterMs));
    }

    const attemptIndex = Math.max(0, record.attempts - 1);
    const exponent = 2 ** attemptIndex;
    return Math.min(normalizedConfig.retry.maxDelayMs, normalizedConfig.retry.baseDelayMs * exponent);
  }

  function buildDiscordPayload(record) {
    const sender = normalizedConfig.senders[record.senderKey];
    const destination = normalizedConfig.destinations[record.destinationKey];

    const fields = [
      { name: "Category", value: getCategoryLabel(record.category), inline: true },
      {
        name: "Severity",
        value: record.severity.charAt(0).toUpperCase() + record.severity.slice(1),
        inline: true,
      },
    ];

    if (record.cardId) {
      fields.push({ name: "Card", value: record.cardId, inline: true });
    }
    if (record.issueIdentifier) {
      fields.push({ name: "Issue", value: record.issueIdentifier, inline: true });
    }
    if (record.projectKey) {
      fields.push({ name: "Project", value: record.projectKey, inline: true });
    }
    if (destination?.label) {
      fields.push({ name: "Destination", value: destination.label, inline: true });
    }

    const payload = {
      username: sender?.displayName || "Mission Control",
      content: `[Mission Control] ${record.title}`,
      embeds: [
        {
          title: record.title,
          description: truncate(record.summary, 2048),
          color: getSeverityColor(record.severity),
          fields,
          footer: {
            text: `Mission Control • ${record.eventKey}`,
          },
          timestamp: record.occurredAt || record.createdAt,
        },
      ],
    };

    if (sender?.avatarUrl) {
      payload.avatar_url = sender.avatarUrl;
    }
    if (sender?.avatarEmoji) {
      payload.content = `${sender.avatarEmoji} ${payload.content}`;
    }

    return payload;
  }

  async function sendDiscordWebhook(record) {
    const destination = normalizedConfig.destinations[record.destinationKey];
    const sender = normalizedConfig.senders[record.senderKey];

    if (!destination || !destination.webhookUrl) {
      return {
        ok: false,
        retryable: false,
        statusCode: null,
        message: `Unknown Discord destination '${record.destinationKey}'`,
      };
    }

    if (!sender) {
      return {
        ok: false,
        retryable: false,
        statusCode: null,
        message: `Unknown Discord sender '${record.senderKey}'`,
      };
    }

    if (destination.allowedSenders.length > 0 && !destination.allowedSenders.includes(record.senderKey)) {
      return {
        ok: false,
        retryable: false,
        statusCode: null,
        message: `Sender '${record.senderKey}' is not allowed for destination '${record.destinationKey}'`,
      };
    }

    const payload = buildDiscordPayload(record);

    try {
      const response = await fetchImpl(destination.webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "openclaw-command-center/mission-control",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return {
          ok: true,
          statusCode: response.status,
          payload,
        };
      }

      const message = truncate(await response.text(), 512) || `Discord returned ${response.status}`;
      return {
        ok: false,
        retryable: response.status === 429 || response.status >= 500,
        statusCode: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after")),
        message,
      };
    } catch (error) {
      return {
        ok: false,
        retryable: true,
        statusCode: null,
        message: error.message,
      };
    }
  }

  async function runDelivery(record) {
    while (record.attempts < record.maxAttempts) {
      record.attempts += 1;
      record.status = record.attempts === 1 ? "queued" : "retrying";
      record.lastAttemptAt = isoNow();
      record.nextAttemptAt = null;
      saveState();

      const result = await sendDiscordWebhook(record);
      if (result.ok) {
        record.status = "delivered";
        record.deadLetter = false;
        record.deliveredAt = isoNow();
        record.failedAt = null;
        record.lastError = null;
        record.nextAttemptAt = null;
        state.lastSuccessAt = record.deliveredAt;
        saveState();
        return {
          delivered: true,
          deduped: false,
          record: redactRecord(record),
        };
      }

      const failureTime = isoNow();
      record.lastError = {
        message: result.message,
        statusCode: result.statusCode,
        retryAfterMs: result.retryAfterMs || null,
        at: failureTime,
      };
      state.lastErrorAt = failureTime;

      const canRetry = result.retryable && record.attempts < record.maxAttempts;
      if (canRetry) {
        const delayMs = computeDelayMs(record, result.retryAfterMs);
        record.status = "retrying";
        record.nextAttemptAt = new Date(now() + delayMs).toISOString();
        saveState();
        await sleep(delayMs);
        continue;
      }

      record.status = "failed";
      record.deadLetter = true;
      record.failedAt = failureTime;
      record.nextAttemptAt = null;
      saveState();
      return {
        delivered: false,
        deduped: false,
        record: redactRecord(record),
        error: clone(record.lastError),
      };
    }

    record.status = "failed";
    record.deadLetter = true;
    record.failedAt = isoNow();
    saveState();
    return {
      delivered: false,
      deduped: false,
      record: redactRecord(record),
      error: clone(record.lastError),
    };
  }

  function beginDelivery(record) {
    const deliveryPromise = runDelivery(record)
      .catch((error) => {
        logger.error("[Mission Control] Discord delivery failed:", error.message);
        record.status = "failed";
        record.deadLetter = true;
        record.failedAt = isoNow();
        record.lastError = {
          message: error.message,
          statusCode: null,
          retryAfterMs: null,
          at: record.failedAt,
        };
        state.lastErrorAt = record.failedAt;
        saveState();
        return {
          delivered: false,
          deduped: false,
          record: redactRecord(record),
          error: clone(record.lastError),
        };
      })
      .finally(() => {
        inFlightDeliveries.delete(record.eventKey);
      });

    inFlightDeliveries.set(record.eventKey, deliveryPromise);
    return deliveryPromise;
  }

  async function deliverEvent(input, options = {}) {
    const waitForCompletion = options.wait !== false;

    if (!normalizedConfig.enabled) {
      return { delivered: false, skipped: true, reason: "Mission Control notifications disabled" };
    }

    const normalizedEvent = normalizeNotificationEvent(input, normalizedConfig, now);
    const existingRecord = state.records[normalizedEvent.eventKey];

    if (existingRecord) {
      existingRecord.dedupeHits = (existingRecord.dedupeHits || 0) + 1;
      saveState();

      const inFlight = inFlightDeliveries.get(normalizedEvent.eventKey);
      if (waitForCompletion && inFlight) {
        return inFlight;
      }

      return {
        delivered: existingRecord.status === "delivered",
        deduped: true,
        record: redactRecord(existingRecord),
      };
    }

    const record = {
      ...normalizedEvent,
      status: "queued",
      attempts: 0,
      maxAttempts: normalizedConfig.retry.maxAttempts,
      dedupeHits: 0,
      deadLetter: false,
      deliveredAt: null,
      failedAt: null,
      nextAttemptAt: null,
      lastAttemptAt: null,
      lastError: null,
    };

    state.records[record.eventKey] = record;
    saveState();

    const deliveryPromise = beginDelivery(record);
    if (!waitForCompletion) {
      return {
        delivered: false,
        queued: true,
        deduped: false,
        record: redactRecord(record),
      };
    }

    return deliveryPromise;
  }

  async function waitForIdle() {
    await Promise.allSettled(Array.from(inFlightDeliveries.values()));
  }

  function resumePendingDeliveries() {
    const pendingRecords = Object.values(state.records).filter(
      (record) =>
        (record.status === "queued" || record.status === "retrying") &&
        record.attempts < record.maxAttempts &&
        !inFlightDeliveries.has(record.eventKey),
    );

    for (const record of pendingRecords) {
      const waitMs = record.nextAttemptAt
        ? Math.max(0, Date.parse(record.nextAttemptAt) - now())
        : 0;

      const promise = (async () => {
        if (waitMs > 0) {
          await sleep(waitMs);
        }
        return runDelivery(record);
      })().finally(() => {
        inFlightDeliveries.delete(record.eventKey);
      });

      inFlightDeliveries.set(record.eventKey, promise);
    }
  }

  resumePendingDeliveries();

  return {
    buildDiscordPayload,
    deliverEvent,
    getState,
    waitForIdle,
  };
}

module.exports = {
  createNotificationsModule,
  parseRetryAfterMs,
};
