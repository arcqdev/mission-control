const fs = require("fs");
const path = require("path");

const SNAPSHOT_FILENAME = "discord-notifications.json";
const SCHEMA_VERSION = 1;
const MAX_ATTEMPTS = 4;
const MAX_RECENT_NOTIFICATIONS = 50;
const MAX_SETTLED_KEYS = 250;
const MAX_ACTIVE_REVIEW_KEYS = 500;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

function isoNow(now = Date.now) {
  const value = typeof now === "function" ? now() : now;
  return new Date(value).toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeSnapshot(filePath, payload) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function cleanString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function cleanNullableString(value) {
  const cleaned = cleanString(value);
  return cleaned || null;
}

function toStatusLabel(status) {
  return cleanString(status).replace(/_/g, " ") || "unknown";
}

function parseRetryAfterMs(retryAfter, now = Date.now) {
  const value = cleanString(retryAfter);
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const parsedDate = Date.parse(value);
  if (Number.isNaN(parsedDate)) {
    return null;
  }

  return Math.max(0, parsedDate - now());
}

function getBackoffMs(attemptCount, retryAfterMs = null) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(MAX_BACKOFF_MS, retryAfterMs);
  }

  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attemptCount - 1));
}

function normalizeSettledEntry(entry) {
  return {
    key: cleanString(entry?.key),
    settledAt: cleanNullableString(entry?.settledAt),
  };
}

function normalizeNotificationEntry(entry) {
  return {
    id: cleanString(entry?.id),
    category: cleanString(entry?.category) || "exception",
    eventKey: cleanString(entry?.eventKey),
    destinationKey: cleanString(entry?.destinationKey) || "unroutable",
    destinationLabel: cleanNullableString(entry?.destinationLabel),
    senderIdentity: cleanNullableString(entry?.senderIdentity),
    webhookUrl: cleanNullableString(entry?.webhookUrl),
    title: cleanString(entry?.title) || "Mission Control notification",
    summary: cleanString(entry?.summary),
    identifier: cleanNullableString(entry?.identifier),
    cardId: cleanNullableString(entry?.cardId),
    cardStatus: cleanNullableString(entry?.cardStatus),
    occurredAt: cleanNullableString(entry?.occurredAt),
    createdAt: cleanNullableString(entry?.createdAt),
    lastAttemptAt: cleanNullableString(entry?.lastAttemptAt),
    nextAttemptAt: cleanNullableString(entry?.nextAttemptAt),
    deliveredAt: cleanNullableString(entry?.deliveredAt),
    deadLetteredAt: cleanNullableString(entry?.deadLetteredAt),
    responseStatus:
      entry?.responseStatus === null || entry?.responseStatus === undefined
        ? null
        : Number(entry.responseStatus),
    error: cleanNullableString(entry?.error),
    status: cleanString(entry?.status) || "queued",
    attemptCount: Number.parseInt(String(entry?.attemptCount || 0), 10) || 0,
    payload: entry?.payload && typeof entry.payload === "object" ? entry.payload : null,
  };
}

function createInitialState(now = Date.now) {
  return {
    version: SCHEMA_VERSION,
    updatedAt: isoNow(now),
    lastExceptionFingerprint: null,
    notifications: [],
    settledEventDestinations: [],
    activeReviewKeys: [],
  };
}

function buildEntryKey(eventKey, destinationKey) {
  return `${eventKey}:${destinationKey}`;
}

function uniqueDestinations(destinations) {
  const byWebhook = new Map();

  for (const destination of destinations || []) {
    const webhookUrl = cleanNullableString(destination?.webhookUrl);
    if (!webhookUrl) {
      continue;
    }
    if (!byWebhook.has(webhookUrl)) {
      byWebhook.set(webhookUrl, destination);
    }
  }

  return [...byWebhook.values()];
}

function buildDiscordPayload(notification) {
  const color =
    notification.category === "completion"
      ? 0x3fb950
      : notification.category === "review"
        ? 0xd29922
        : 0xf85149;
  const header =
    notification.category === "completion"
      ? "Mission complete"
      : notification.category === "review"
        ? "Human review required"
        : "Mission exception";
  const fields = [];

  if (notification.identifier) {
    fields.push({ name: "Issue", value: notification.identifier, inline: true });
  }
  if (notification.cardStatus) {
    fields.push({ name: "Status", value: toStatusLabel(notification.cardStatus), inline: true });
  }
  if (notification.destinationLabel) {
    fields.push({ name: "Destination", value: notification.destinationLabel, inline: true });
  }
  if (notification.senderIdentity) {
    fields.push({ name: "Sender", value: notification.senderIdentity, inline: true });
  }

  return {
    username: "Mission Control",
    allowed_mentions: { parse: [] },
    content: `${header}: ${notification.title}`,
    embeds: [
      {
        title: notification.title,
        description: notification.summary,
        color,
        fields,
        footer: {
          text: `Mission Control notification v1 • ${notification.category} • ${notification.eventKey}`,
        },
        timestamp: notification.occurredAt || notification.createdAt || isoNow(),
      },
    ],
  };
}

function postDiscordWebhook({ webhookUrl, payload, fetchImpl = globalThis.fetch, now = Date.now }) {
  return fetchImpl(webhookUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "openclaw-command-center/mission-control",
    },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
        };
      }

      const responseText = await response.text().catch(() => "");
      return {
        ok: false,
        status: response.status,
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.("retry-after"), now),
        error:
          cleanNullableString(responseText) ||
          `Discord webhook rejected with HTTP ${response.status}`,
      };
    })
    .catch((error) => ({
      ok: false,
      status: null,
      retryable: true,
      retryAfterMs: null,
      error: error.message,
    }));
}

function deriveCardNotificationPolicy({ card, registry }) {
  const agents = Array.isArray(registry?.agents) ? registry.agents : [];
  const destinations = Array.isArray(registry?.discordDestinations)
    ? registry.discordDestinations
    : [];
  const destinationByKey = new Map(
    destinations.map((destination) => [destination.key, destination]),
  );

  const explicitDestinationKey = cleanNullableString(card?.notificationPolicy?.destinationKey);
  const explicitSenderIdentity = cleanNullableString(card?.notificationPolicy?.senderIdentity);
  const preferredAgent =
    agents.find((agent) => (card?.responsibleAgents || []).includes(agent.key)) ||
    agents.find((agent) => agent.defaultLane === card?.lane) ||
    null;
  const senderIdentity = explicitSenderIdentity || preferredAgent?.key || null;
  const destinationKey =
    explicitDestinationKey || preferredAgent?.defaultNotificationProfile || senderIdentity || null;
  const destination = destinationKey ? destinationByKey.get(destinationKey) : null;

  if (!destination) {
    return {
      enabled: false,
      destinationKey,
      senderIdentity,
      reason: "No matching Discord destination configured",
    };
  }

  if (!destination.webhookUrl) {
    return {
      enabled: false,
      destinationKey: destination.key,
      senderIdentity,
      reason: `Discord destination '${destination.key}' is missing webhookUrl`,
    };
  }

  const allowed = Array.isArray(destination.allowedSenderIdentities)
    ? destination.allowedSenderIdentities
    : [];
  if (allowed.length > 0 && senderIdentity && !allowed.includes(senderIdentity)) {
    return {
      enabled: false,
      destinationKey: destination.key,
      senderIdentity,
      reason: `Discord destination '${destination.key}' does not allow sender '${senderIdentity}'`,
    };
  }

  return {
    enabled: true,
    destinationKey: destination.key,
    senderIdentity,
    reason: null,
  };
}

function createMissionControlNotificationService({
  registry,
  dataDir,
  now = Date.now,
  logger = console,
  fetchImpl = globalThis.fetch,
  onChange = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const rootDir = path.join(dataDir, "mission-control");
  const snapshotPath = path.join(rootDir, SNAPSHOT_FILENAME);
  const pendingTimers = new Map();
  const inFlight = new Set();
  let state = createInitialState(now);

  const destinations = Array.isArray(registry?.discordDestinations)
    ? registry.discordDestinations
    : [];
  const destinationByKey = new Map(
    destinations.map((destination) => [destination.key, destination]),
  );

  try {
    ensureDir(rootDir);
    if (fs.existsSync(snapshotPath)) {
      const loaded = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      state = {
        ...createInitialState(now),
        ...loaded,
        notifications: Array.isArray(loaded.notifications)
          ? loaded.notifications
              .map(normalizeNotificationEntry)
              .filter((entry) => entry.id && entry.eventKey)
          : [],
        settledEventDestinations: Array.isArray(loaded.settledEventDestinations)
          ? loaded.settledEventDestinations.map(normalizeSettledEntry).filter((entry) => entry.key)
          : [],
        activeReviewKeys: Array.isArray(loaded.activeReviewKeys)
          ? loaded.activeReviewKeys.map((key) => cleanString(key)).filter(Boolean)
          : [],
      };
    }
  } catch (error) {
    logger.warn?.(
      `[Mission Control] Failed to load Discord notification snapshot: ${error.message}`,
    );
  }

  function compactState() {
    const unsettled = state.notifications.filter((entry) =>
      ["queued", "retrying", "sending"].includes(entry.status),
    );
    const settled = state.notifications
      .filter((entry) => ["delivered", "dead_letter"].includes(entry.status))
      .sort(
        (left, right) =>
          Date.parse(right.deliveredAt || right.deadLetteredAt || right.createdAt || 0) -
          Date.parse(left.deliveredAt || left.deadLetteredAt || left.createdAt || 0),
      )
      .slice(0, MAX_RECENT_NOTIFICATIONS);

    state.notifications = [...unsettled, ...settled];
    state.settledEventDestinations = state.settledEventDestinations.slice(-MAX_SETTLED_KEYS);
    state.activeReviewKeys = state.activeReviewKeys.slice(-MAX_ACTIVE_REVIEW_KEYS);
  }

  function persist() {
    compactState();
    state.updatedAt = isoNow(now);
    writeSnapshot(snapshotPath, state);
  }

  function emit() {
    try {
      onChange({
        type: "notification-updated",
        notifications: getPublicState(),
      });
    } catch (_error) {
      // Ignore observer failures to keep delivery resilient.
    }
  }

  function markSettled(notification) {
    const key = buildEntryKey(notification.eventKey, notification.destinationKey);
    state.settledEventDestinations = state.settledEventDestinations
      .filter((entry) => entry.key !== key)
      .concat({ key, settledAt: isoNow(now) });
  }

  function hasExistingNotification(eventKey, destinationKey) {
    const entryKey = buildEntryKey(eventKey, destinationKey);
    return (
      state.notifications.some(
        (entry) => entry.eventKey === eventKey && entry.destinationKey === destinationKey,
      ) || state.settledEventDestinations.some((entry) => entry.key === entryKey)
    );
  }

  function scheduleNotification(notification) {
    if (!notification?.id) {
      return;
    }

    if (pendingTimers.has(notification.id)) {
      clearTimeoutFn(pendingTimers.get(notification.id));
      pendingTimers.delete(notification.id);
    }

    const nextAttemptAt = Date.parse(
      notification.nextAttemptAt || notification.createdAt || isoNow(now),
    );
    const delayMs = Math.max(0, nextAttemptAt - now());
    const timer = setTimeoutFn(() => {
      pendingTimers.delete(notification.id);
      attemptDelivery(notification.id).catch((error) => {
        logger.error?.(`[Mission Control] Discord delivery crashed: ${error.message}`);
      });
    }, delayMs);

    pendingTimers.set(notification.id, timer);
  }

  function buildCompletionNotification(card) {
    return {
      category: "completion",
      eventKey: `completion:${card.id}:${card.completedAt || card.updatedAt || isoNow(now)}`,
      occurredAt: card.completedAt || card.updatedAt || isoNow(now),
      title: `${card.identifier || card.primaryLinearIdentifier || card.id} completed`,
      summary: card.title,
      identifier: card.identifier || card.primaryLinearIdentifier || card.id,
      cardId: card.id,
      cardStatus: card.status,
    };
  }

  function buildReviewNotification(card, child) {
    return {
      category: "review",
      eventKey: `review:${card.id}:${child.id}:${child.updatedAt || child.completedAt || isoNow(now)}`,
      occurredAt: child.updatedAt || isoNow(now),
      title: `${card.identifier || card.primaryLinearIdentifier || card.id} needs human review`,
      summary: [child.identifier || child.id, child.title, child.reviewReason]
        .filter(Boolean)
        .join(" · "),
      identifier: child.identifier || card.identifier || card.primaryLinearIdentifier || card.id,
      cardId: card.id,
      cardStatus: card.status,
    };
  }

  function buildExceptionNotification({ sync, auditType, occurredAt, source }) {
    const errorMessage = cleanString(sync?.lastError) || "Mission Control reported an exception";
    return {
      category: "exception",
      eventKey: `exception:${auditType || source || "sync"}:${errorMessage}`,
      occurredAt: occurredAt || isoNow(now),
      title:
        auditType === "mission-control.linear.webhook.rejected"
          ? "Linear webhook rejected"
          : "Mission Control exception",
      summary: errorMessage,
      identifier: null,
      cardId: null,
      cardStatus: sync?.status || null,
    };
  }

  function createNotificationRecord(baseNotification, route) {
    const createdAt = isoNow(now);
    const payload = buildDiscordPayload({
      ...baseNotification,
      destinationLabel: route.destinationLabel,
      senderIdentity: route.senderIdentity,
    });

    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      category: baseNotification.category,
      eventKey: baseNotification.eventKey,
      destinationKey: route.destinationKey,
      destinationLabel: route.destinationLabel,
      senderIdentity: route.senderIdentity,
      webhookUrl: route.webhookUrl,
      title: baseNotification.title,
      summary: baseNotification.summary,
      identifier: baseNotification.identifier,
      cardId: baseNotification.cardId,
      cardStatus: baseNotification.cardStatus,
      occurredAt: baseNotification.occurredAt,
      createdAt,
      lastAttemptAt: null,
      nextAttemptAt: createdAt,
      deliveredAt: null,
      deadLetteredAt: null,
      responseStatus: null,
      error: null,
      status: "queued",
      attemptCount: 0,
      payload,
    };
  }

  function recordConfigFailure(baseNotification, route) {
    const destinationKey = route.destinationKey || "unroutable";
    if (hasExistingNotification(baseNotification.eventKey, destinationKey)) {
      return false;
    }

    const createdAt = isoNow(now);
    state.notifications.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      category: baseNotification.category,
      eventKey: baseNotification.eventKey,
      destinationKey,
      destinationLabel: route.destinationLabel || route.destinationKey || "Unroutable",
      senderIdentity: route.senderIdentity || null,
      webhookUrl: route.webhookUrl || null,
      title: baseNotification.title,
      summary: baseNotification.summary,
      identifier: baseNotification.identifier,
      cardId: baseNotification.cardId,
      cardStatus: baseNotification.cardStatus,
      occurredAt: baseNotification.occurredAt,
      createdAt,
      lastAttemptAt: createdAt,
      nextAttemptAt: null,
      deliveredAt: null,
      deadLetteredAt: createdAt,
      responseStatus: null,
      error: route.error || "Discord destination is not deliverable",
      status: "dead_letter",
      attemptCount: 0,
      payload: null,
    });
    markSettled({ eventKey: baseNotification.eventKey, destinationKey });
    persist();
    emit();
    return true;
  }

  function enqueueNotification(baseNotification, routes) {
    let queued = false;

    for (const route of routes) {
      const destinationKey = route.destinationKey || "unroutable";
      if (hasExistingNotification(baseNotification.eventKey, destinationKey)) {
        continue;
      }

      if (!route.webhookUrl || route.error) {
        queued = recordConfigFailure(baseNotification, route) || queued;
        continue;
      }

      const record = createNotificationRecord(baseNotification, route);
      state.notifications.push(record);
      queued = true;
      scheduleNotification(record);
    }

    if (queued) {
      persist();
      emit();
    }

    return queued;
  }

  function getCompletionRoute(card) {
    const policy = deriveCardNotificationPolicy({ card, registry });
    const destination = policy.destinationKey ? destinationByKey.get(policy.destinationKey) : null;
    return {
      destinationKey: policy.destinationKey || "unroutable",
      destinationLabel:
        destination?.channelLabel || destination?.key || policy.destinationKey || "Unroutable",
      senderIdentity: policy.senderIdentity,
      webhookUrl: destination?.webhookUrl || null,
      error: policy.reason,
    };
  }

  function getReviewEntries(card) {
    const children = Array.isArray(card?.linearChildren)
      ? card.linearChildren
      : card?.primaryLinearIssueId
        ? [
            {
              id: card.primaryLinearIssueId,
              identifier: card.primaryLinearIdentifier || card.identifier || card.id,
              title: card.title,
              updatedAt: card.updatedAt,
              humanReviewRequired: card.humanReviewRequired,
              blockedOnHumanReview: String(card.reviewReason || "").includes(
                "blocked-on-human-review",
              ),
              reviewReason: card.reviewReason,
            },
          ]
        : [];

    return children.map((child) => ({
      activeKey: `${card.id}:${child.id}`,
      child,
      active:
        Boolean(child.humanReviewRequired) ||
        Boolean(child.blockedOnHumanReview) ||
        /review/.test(cleanString(child.state?.name || child.reviewReason).toLowerCase()),
    }));
  }

  function syncReviewNotifications(card) {
    const entries = getReviewEntries(card);
    const activeKeysForCard = new Set(
      entries.filter((entry) => entry.active).map((entry) => entry.activeKey),
    );
    const nextActiveKeys = state.activeReviewKeys.filter(
      (key) => !key.startsWith(`${card.id}:`) || activeKeysForCard.has(key),
    );
    let changed = nextActiveKeys.length !== state.activeReviewKeys.length;

    for (const entry of entries) {
      if (!entry.active || state.activeReviewKeys.includes(entry.activeKey)) {
        continue;
      }
      nextActiveKeys.push(entry.activeKey);
      changed = true;
      enqueueNotification(buildReviewNotification(card, entry.child), [getCompletionRoute(card)]);
    }

    if (changed) {
      state.activeReviewKeys = nextActiveKeys;
      persist();
      emit();
    }

    return changed;
  }

  function getExceptionRoutes() {
    const configured = uniqueDestinations(destinations);
    if (configured.length === 0) {
      return [
        {
          destinationKey: "unroutable",
          destinationLabel: "Unroutable",
          senderIdentity: null,
          webhookUrl: null,
          error: "No Discord destinations are configured for Mission Control exception alerts",
        },
      ];
    }

    return configured.map((destination) => ({
      destinationKey: destination.key,
      destinationLabel: destination.channelLabel || destination.key,
      senderIdentity: null,
      webhookUrl: destination.webhookUrl,
      error: !destination.webhookUrl
        ? `Discord destination '${destination.key}' is missing webhookUrl`
        : null,
    }));
  }

  async function attemptDelivery(notificationId) {
    const notification = state.notifications.find((entry) => entry.id === notificationId);
    if (!notification || !["queued", "retrying", "sending"].includes(notification.status)) {
      return null;
    }
    if (inFlight.has(notificationId)) {
      return null;
    }

    inFlight.add(notificationId);
    notification.status = notification.attemptCount > 0 ? "retrying" : "sending";
    notification.attemptCount += 1;
    notification.lastAttemptAt = isoNow(now);
    notification.error = null;
    persist();
    emit();

    try {
      const result = await postDiscordWebhook({
        webhookUrl: notification.webhookUrl,
        payload: notification.payload,
        fetchImpl,
        now,
      });

      if (result.ok) {
        notification.status = "delivered";
        notification.responseStatus = result.status;
        notification.deliveredAt = isoNow(now);
        notification.nextAttemptAt = null;
        notification.error = null;
        markSettled(notification);
      } else if (result.retryable && notification.attemptCount < MAX_ATTEMPTS) {
        const delayMs = getBackoffMs(notification.attemptCount, result.retryAfterMs);
        notification.status = "retrying";
        notification.responseStatus = result.status;
        notification.error = result.error;
        notification.nextAttemptAt = new Date(now() + delayMs).toISOString();
        scheduleNotification(notification);
      } else {
        notification.status = "dead_letter";
        notification.responseStatus = result.status;
        notification.error = result.error;
        notification.deadLetteredAt = isoNow(now);
        notification.nextAttemptAt = null;
        markSettled(notification);
      }

      persist();
      emit();
      return result;
    } finally {
      inFlight.delete(notificationId);
    }
  }

  function handleMissionControlChange(change, publicState) {
    if (change?.type === "card-upserted") {
      const cards = (publicState?.masterCards || []).filter(
        (entry) =>
          entry.id === change.cardId ||
          entry.primaryLinearIssueId === change.issueId ||
          entry.primaryLinearIdentifier === change.identifier ||
          (entry.linkedLinearIssueIds || []).includes(change.issueId) ||
          (entry.linkedLinearIdentifiers || []).includes(change.identifier),
      );
      let changed = false;

      for (const card of cards) {
        changed = syncReviewNotifications(card) || changed;
        if (card.status === "completed") {
          changed =
            enqueueNotification(buildCompletionNotification(card), [getCompletionRoute(card)]) ||
            changed;
        }
      }

      return changed;
    }

    if (change?.type === "sync-updated") {
      const sync = publicState?.sync || change.sync || {};
      const auditType = change.auditType || null;
      const shouldReset = sync.status === "ok" || !cleanString(sync.lastError);

      if (shouldReset) {
        state.lastExceptionFingerprint = null;
        persist();
        emit();
        return false;
      }

      const isExceptionEvent =
        auditType === "mission-control.linear.reconcile.failed" ||
        auditType === "mission-control.linear.webhook.rejected" ||
        cleanString(change.partial?.persistence?.lastWriteError) !== "";

      if (!isExceptionEvent) {
        return false;
      }

      const fingerprint = `${auditType || sync.status}:${cleanString(sync.lastError)}`;
      if (state.lastExceptionFingerprint === fingerprint) {
        return false;
      }

      state.lastExceptionFingerprint = fingerprint;
      persist();

      return enqueueNotification(
        buildExceptionNotification({
          sync,
          auditType,
          occurredAt: change.occurredAt,
          source: change.source,
        }),
        getExceptionRoutes(),
      );
    }

    return false;
  }

  function getPublicState() {
    const notifications = [...state.notifications].sort(
      (left, right) =>
        Date.parse(right.createdAt || right.occurredAt || 0) -
        Date.parse(left.createdAt || left.occurredAt || 0),
    );
    const retrying = notifications.filter((entry) => entry.status === "retrying");
    const sending = notifications.filter((entry) => entry.status === "sending");
    const queued = notifications.filter((entry) => entry.status === "queued");
    const deadLetters = notifications.filter((entry) => entry.status === "dead_letter");
    const delivered = notifications.filter((entry) => entry.status === "delivered");
    const latestProblem = [...deadLetters, ...retrying, ...sending]
      .sort(
        (left, right) =>
          Date.parse(right.lastAttemptAt || right.createdAt || 0) -
          Date.parse(left.lastAttemptAt || left.createdAt || 0),
      )
      .find(Boolean);

    let status = "ok";
    let summary = "Discord notifications are healthy.";
    let alertBanner = null;

    if (deadLetters.length > 0) {
      status = "error";
      summary = `${deadLetters.length} Discord notification(s) moved to dead-letter.`;
      alertBanner = {
        level: "error",
        title: "Discord delivery requires attention",
        message: `${deadLetters.length} notification(s) moved to dead-letter${retrying.length > 0 ? ` · ${retrying.length} still retrying` : ""}.`,
        detail: latestProblem?.error || null,
      };
    } else if (retrying.length > 0 || sending.length > 0 || queued.length > 0) {
      status = "degraded";
      summary = `${retrying.length + sending.length + queued.length} Discord notification(s) are pending delivery.`;
      alertBanner = {
        level: "warning",
        title: "Discord delivery is retrying",
        message: `${retrying.length + sending.length + queued.length} notification(s) are pending delivery.`,
        detail: latestProblem?.error || null,
      };
    }

    return {
      version: SCHEMA_VERSION,
      updatedAt: state.updatedAt,
      status,
      summary,
      destinations: destinations.map((destination) => ({
        key: destination.key,
        channelLabel: destination.channelLabel,
        configured: Boolean(destination.webhookUrl),
      })),
      stats: {
        totalConfigured: destinations.filter((destination) => destination.webhookUrl).length,
        queued: queued.length,
        retrying: retrying.length + sending.length,
        delivered: delivered.length,
        deadLetters: deadLetters.length,
      },
      alertBanner,
      recentDeliveries: notifications.slice(0, 10).map((entry) => ({
        id: entry.id,
        category: entry.category,
        eventKey: entry.eventKey,
        destinationKey: entry.destinationKey,
        destinationLabel: entry.destinationLabel,
        title: entry.title,
        summary: entry.summary,
        identifier: entry.identifier,
        status: entry.status,
        attemptCount: entry.attemptCount,
        createdAt: entry.createdAt,
        lastAttemptAt: entry.lastAttemptAt,
        nextAttemptAt: entry.nextAttemptAt,
        deliveredAt: entry.deliveredAt,
        deadLetteredAt: entry.deadLetteredAt,
        responseStatus: entry.responseStatus,
        error: entry.error,
      })),
    };
  }

  for (const notification of state.notifications) {
    if (["queued", "retrying", "sending"].includes(notification.status)) {
      scheduleNotification(notification);
    }
  }

  return {
    getPublicState,
    handleMissionControlChange,
  };
}

module.exports = {
  buildDiscordPayload,
  createMissionControlNotificationService,
  deriveCardNotificationPolicy,
  parseRetryAfterMs,
  postDiscordWebhook,
};
