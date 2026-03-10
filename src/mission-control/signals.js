function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return "0m";
  }

  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function isTerminalCard(card) {
  const stateType = String(card?.state?.type || "").toLowerCase();
  return ["completed", "done", "canceled", "cancelled"].includes(stateType);
}

function isBlockedCard(card) {
  const stateName = String(card?.state?.name || "").toLowerCase();
  const stateType = String(card?.state?.type || "").toLowerCase();
  const labels = Array.isArray(card?.labels) ? card.labels : [];

  return (
    stateType === "blocked" ||
    stateName.includes("blocked") ||
    labels.some((label) => {
      const name = String(label?.name || "").toLowerCase();
      return name === "blocked" || name === "blocker" || name === "dispatch:blocked";
    })
  );
}

function getStaleThresholdMs(card) {
  if (isBlockedCard(card)) {
    return 8 * 60 * 60 * 1000;
  }

  const stateType = String(card?.state?.type || "").toLowerCase();
  if (["started", "in_progress"].includes(stateType)) {
    return 6 * 60 * 60 * 1000;
  }
  if (
    stateType === "review" ||
    String(card?.state?.name || "")
      .toLowerCase()
      .includes("review")
  ) {
    return 12 * 60 * 60 * 1000;
  }

  return 24 * 60 * 60 * 1000;
}

function getCardTimestamp(card) {
  return card?.updatedAt || card?.startedAt || card?.createdAt || null;
}

function deriveMissionCardSignals({ card, project, runtimeProject, now = Date.now }) {
  const nowMs = typeof now === "function" ? now() : now;
  const updatedAt = getCardTimestamp(card);
  const updatedAtMs = updatedAt ? Date.parse(updatedAt) : nowMs;
  const ageMs = Math.max(0, nowMs - (Number.isNaN(updatedAtMs) ? nowMs : updatedAtMs));
  const terminal = isTerminalCard(card);
  const blocked = isBlockedCard(card);
  const staleThresholdMs = getStaleThresholdMs(card);
  const stale = !terminal && ageMs >= staleThresholdMs;
  const runtimeStatus = runtimeProject?.symphony?.status || "unknown";
  const degraded = runtimeStatus === "degraded" || runtimeStatus === "unreachable";
  const signals = [];

  if (blocked) {
    signals.push("blocked");
  }
  if (stale) {
    signals.push("stale-work");
  }
  if (runtimeStatus === "unreachable") {
    signals.push("symphony-down");
  } else if (runtimeStatus === "degraded") {
    signals.push("symphony-degraded");
  }

  let risk = "low";
  if (!terminal && (runtimeStatus === "unreachable" || (blocked && stale))) {
    risk = "high";
  } else if (!terminal && (blocked || stale || runtimeStatus === "degraded")) {
    risk = "medium";
  }

  let status = "ok";
  if (degraded) {
    status = "degraded";
  } else if (blocked) {
    status = "blocked";
  } else if (stale) {
    status = "stale";
  }

  return {
    lane: project?.lane || null,
    projectKey: project?.key || null,
    status,
    degraded,
    blocked,
    risk,
    signals,
    ageMs,
    ageLabel: formatDuration(ageMs),
    stale,
    staleThresholdMs,
    staleThresholdLabel: formatDuration(staleThresholdMs),
    symphony: runtimeProject?.symphony || null,
  };
}

function deriveProjectSignals({ project, cards, runtimeProject }) {
  const cardList = Array.isArray(cards) ? cards : [];
  const staleCardCount = cardList.filter((card) => card.healthStrip?.stale).length;
  const blockedCardCount = cardList.filter((card) => card.healthStrip?.blocked).length;
  const highRiskCardCount = cardList.filter((card) => card.healthStrip?.risk === "high").length;
  const degraded = ["degraded", "unreachable"].includes(runtimeProject?.symphony?.status);
  const signals = [];

  if (degraded) {
    signals.push("symphony-down");
  }
  if (blockedCardCount > 0) {
    signals.push("blocked-cards");
  }
  if (staleCardCount > 0) {
    signals.push("stale-work");
  }

  let risk = "low";
  if (degraded || highRiskCardCount > 0) {
    risk = "high";
  } else if (blockedCardCount > 0 || staleCardCount > 0) {
    risk = "medium";
  }

  let status = "ok";
  if (degraded) {
    status = "degraded";
  } else if (blockedCardCount > 0) {
    status = "blocked";
  } else if (staleCardCount > 0) {
    status = "stale";
  }

  return {
    lane: project?.lane || null,
    status,
    degraded,
    risk,
    cardCount: cardList.length,
    staleCardCount,
    blockedCardCount,
    highRiskCardCount,
    signals,
    symphony: runtimeProject?.symphony || null,
  };
}

module.exports = {
  deriveMissionCardSignals,
  deriveProjectSignals,
  formatDuration,
  getStaleThresholdMs,
  isBlockedCard,
};
