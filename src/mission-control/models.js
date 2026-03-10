const VALID_CATEGORIES = new Set(["completion", "exception"]);
const VALID_SEVERITIES = new Set(["info", "warn", "critical"]);

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  }

  return Boolean(value);
}

function isIsoDate(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(value));
}

function createEmptyNotificationsState() {
  return {
    version: 1,
    updatedAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    records: {},
  };
}

function normalizeNotificationsConfig(config = {}) {
  const discordConfig = config.discord || {};
  const retryConfig = discordConfig.retry || {};

  const destinations = Object.fromEntries(
    Object.entries(discordConfig.destinations || {}).map(([key, value]) => [
      key,
      {
        key,
        label: value?.label || key,
        webhookUrl: value?.webhookUrl || value?.url || null,
        allowedSenders: Array.isArray(value?.allowedSenders) ? value.allowedSenders : [],
      },
    ]),
  );

  const senders = Object.fromEntries(
    Object.entries(discordConfig.senders || {}).map(([key, value]) => [
      key,
      {
        key,
        displayName: value?.displayName || key,
        avatarUrl: value?.avatarUrl || null,
        avatarEmoji: value?.avatarEmoji || null,
        defaultDestinationKey:
          value?.defaultDestinationKey || value?.defaultDestinationKeys?.[0] || null,
      },
    ]),
  );

  return {
    enabled: normalizeBoolean(config.enabled, false),
    defaults: {
      senderKey: discordConfig.defaults?.senderKey || Object.keys(senders)[0] || null,
      destinationKey:
        discordConfig.defaults?.destinationKey || Object.keys(destinations)[0] || null,
    },
    retry: {
      maxAttempts: Math.max(1, Number.parseInt(retryConfig.maxAttempts || "3", 10)),
      baseDelayMs: Math.max(0, Number.parseInt(retryConfig.baseDelayMs || "1000", 10)),
      maxDelayMs: Math.max(0, Number.parseInt(retryConfig.maxDelayMs || "30000", 10)),
    },
    destinations,
    senders,
  };
}

function normalizeNotificationEvent(input, config, now = () => Date.now()) {
  if (!input || typeof input !== "object") {
    throw new Error("Mission Control event payload must be an object");
  }

  const eventKey = String(input.eventKey || "").trim();
  if (!eventKey) {
    throw new Error("eventKey is required");
  }

  const category = String(input.category || "").trim().toLowerCase();
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error("category must be 'completion' or 'exception'");
  }

  const severity = VALID_SEVERITIES.has(String(input.severity || "").trim().toLowerCase())
    ? String(input.severity).trim().toLowerCase()
    : category === "exception"
      ? "critical"
      : "info";

  const title = String(input.title || "").trim();
  if (!title) {
    throw new Error("title is required");
  }

  const summary = String(input.summary || input.message || "").trim();
  if (!summary) {
    throw new Error("summary is required");
  }

  const senderKey =
    String(input.senderKey || "").trim() || String(config.defaults.senderKey || "").trim();

  const configuredSender = senderKey ? config.senders[senderKey] : null;
  const destinationKey =
    String(input.destinationKey || "").trim() ||
    configuredSender?.defaultDestinationKey ||
    String(config.defaults.destinationKey || "").trim();

  return {
    eventKey,
    category,
    severity,
    title,
    summary,
    senderKey,
    destinationKey,
    cardId: input.cardId ? String(input.cardId) : null,
    issueIdentifier: input.issueIdentifier ? String(input.issueIdentifier) : null,
    projectKey: input.projectKey ? String(input.projectKey) : null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    occurredAt: isIsoDate(input.occurredAt) ? new Date(input.occurredAt).toISOString() : null,
    createdAt: new Date(now()).toISOString(),
  };
}

module.exports = {
  createEmptyNotificationsState,
  normalizeBoolean,
  normalizeNotificationEvent,
  normalizeNotificationsConfig,
};
