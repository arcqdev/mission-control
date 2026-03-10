const os = require("os");
const path = require("path");

const HOME = os.homedir();

const MISSION_CONTROL_SCHEMA_VERSION = 1;

const VALID_LANES = new Set(["lane:jon", "lane:mia", "lane:pepper"]);
const VALID_RISKS = new Set(["risk:low", "risk:high"]);
const VALID_DISPATCH_STATES = new Set(["dispatch:ready", "dispatch:blocked"]);
const VALID_CARD_STATUSES = new Set([
  "new",
  "ready",
  "in_progress",
  "blocked",
  "awaiting_review",
  "completed",
  "cancelled",
  "stale",
]);
const VALID_DEPENDENCY_KINDS = new Set(["master-card", "linear-issue", "human-review", "external"]);
const VALID_DEPENDENCY_STATUSES = new Set(["open", "resolved"]);
const HUMAN_REVIEW_LABELS = new Set([
  "human-review",
  "human_review",
  "human review",
  "awaiting-review",
  "awaiting_review",
  "awaiting review",
  "needs-review",
  "needs_review",
  "needs review",
  "blocked-on-human-review",
  "blocked_on_human_review",
  "blocked on human review",
]);

function toIsoTimestamp(value = new Date()) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
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

function uniqueSortedStrings(values) {
  return [...new Set((values || []).map(cleanString).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right),
  );
}

function normalizeLane(value, fallback = null) {
  const candidate = cleanString(value);
  if (VALID_LANES.has(candidate)) {
    return candidate;
  }

  if (fallback !== null) {
    return normalizeLane(fallback, null);
  }

  return null;
}

function normalizeRisk(value, fallback = "risk:low") {
  const candidate = cleanString(value);
  if (VALID_RISKS.has(candidate)) {
    return candidate;
  }

  return fallback;
}

function normalizeDispatch(value, fallback = null) {
  const candidate = cleanString(value);
  if (!candidate) {
    return fallback;
  }

  if (VALID_DISPATCH_STATES.has(candidate)) {
    return candidate;
  }

  return fallback;
}

function normalizeCardStatus(value, fallback = "new") {
  const candidate = cleanString(value);
  if (VALID_CARD_STATUSES.has(candidate)) {
    return candidate;
  }

  return fallback;
}

function normalizeDependency(dependency) {
  const kind = VALID_DEPENDENCY_KINDS.has(cleanString(dependency?.kind))
    ? cleanString(dependency.kind)
    : "external";
  const status = VALID_DEPENDENCY_STATUSES.has(cleanString(dependency?.status))
    ? cleanString(dependency.status)
    : "open";

  return {
    kind,
    id: cleanString(dependency?.id),
    label: cleanString(dependency?.label),
    status,
    blocking: dependency?.blocking !== false,
  };
}

function normalizeSculptedObject(source, fallback = {}) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return fallback;
  }

  return source;
}

function getLabelNames(labelSource) {
  if (!labelSource) {
    return [];
  }

  const labels = Array.isArray(labelSource)
    ? labelSource
    : Array.isArray(labelSource.nodes)
      ? labelSource.nodes
      : [];

  return uniqueSortedStrings(
    labels.map((label) => {
      if (typeof label === "string") {
        return label;
      }

      return label?.name || label?.label || "";
    }),
  );
}

function summarizeDescription(description) {
  const text = cleanString(description).replace(/\s+/g, " ");
  if (!text) {
    return "";
  }

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function extractLaneFromLabels(labelNames, fallback = null) {
  return normalizeLane(
    labelNames.find((label) => label.startsWith("lane:")),
    fallback,
  );
}

function extractRiskFromLabels(labelNames, fallback = "risk:low") {
  return normalizeRisk(
    labelNames.find((label) => label.startsWith("risk:")),
    fallback,
  );
}

function extractDispatchFromLabels(labelNames, fallback = null) {
  return normalizeDispatch(
    labelNames.find((label) => label.startsWith("dispatch:")),
    fallback,
  );
}

function normalizeProjectRegistryEntry(project, options = {}) {
  const now = toIsoTimestamp(options.now);
  const key = cleanString(project?.key);
  const label = cleanString(project?.label) || key;
  const repoPath = cleanString(
    project?.repoPath || project?.path || (key === "mission-control" ? process.cwd() : ""),
  );
  const linearProjectSlug = cleanString(project?.linearProjectSlug || project?.linearSlug);
  const lane = normalizeLane(project?.lane);

  if (!key) {
    throw new Error("Mission Control project registry entry is missing key");
  }

  if (!repoPath) {
    throw new Error(`Mission Control project '${key}' is missing repoPath`);
  }

  if (!linearProjectSlug) {
    throw new Error(`Mission Control project '${key}' is missing linearProjectSlug`);
  }

  if (!lane) {
    throw new Error(`Mission Control project '${key}' is missing a valid lane`);
  }

  let symphonyPort = null;
  if (
    project?.symphonyPort !== null &&
    project?.symphonyPort !== undefined &&
    project?.symphonyPort !== ""
  ) {
    const parsed = Number.parseInt(String(project.symphonyPort), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Mission Control project '${key}' has invalid symphonyPort`);
    }
    symphonyPort = parsed;
  }

  const symphonyProtocol = cleanString(project?.symphonyProtocol || project?.protocol) || "http";
  const symphonyHost = cleanString(project?.symphonyHost || project?.host) || "127.0.0.1";
  const symphonyHealthPath =
    cleanString(project?.symphonyHealthPath || project?.healthPath) || "/health";
  const normalizedHealthPath = symphonyHealthPath.startsWith("/")
    ? symphonyHealthPath
    : `/${symphonyHealthPath}`;
  const symphony = symphonyPort
    ? {
        protocol: symphonyProtocol,
        host: symphonyHost,
        healthPath: normalizedHealthPath,
        url: `${symphonyProtocol}://${symphonyHost}:${symphonyPort}${normalizedHealthPath}`,
      }
    : null;

  return {
    key,
    label,
    repoPath: path.normalize(
      repoPath
        .replace(/^~/, HOME)
        .replace(/\$HOME/g, HOME)
        .replace(/\$\{HOME\}/g, HOME),
    ),
    linearProjectSlug,
    lane,
    symphonyPort,
    symphony,
    createdAt: toIsoTimestamp(project?.createdAt || now),
    updatedAt: toIsoTimestamp(project?.updatedAt || now),
  };
}

function normalizeAgentIdentity(agent, options = {}) {
  const now = toIsoTimestamp(options.now);
  const key = cleanString(agent?.key);
  if (!key) {
    throw new Error("Mission Control agent identity is missing key");
  }

  const defaultLane = normalizeLane(agent?.defaultLane, null);
  if (!defaultLane) {
    throw new Error(`Mission Control agent '${key}' is missing a valid defaultLane`);
  }

  return {
    key,
    displayName: cleanString(agent?.displayName) || key,
    defaultLane,
    defaultNotificationProfile: cleanNullableString(agent?.defaultNotificationProfile),
    avatar: cleanNullableString(agent?.avatar),
    heartbeatSources: uniqueSortedStrings(agent?.heartbeatSources || []),
    createdAt: toIsoTimestamp(agent?.createdAt || now),
    updatedAt: toIsoTimestamp(agent?.updatedAt || now),
  };
}

function normalizeDiscordDestination(destination) {
  const key = cleanString(destination?.key);
  if (!key) {
    throw new Error("Mission Control Discord destination is missing key");
  }

  return {
    key,
    channelLabel: cleanString(destination?.channelLabel),
    webhookUrl: cleanNullableString(destination?.webhookUrl),
    allowedSenderIdentities: uniqueSortedStrings(destination?.allowedSenderIdentities || []),
  };
}

function normalizeOutcomeLink(link) {
  const url = cleanNullableString(link?.url);
  if (!url) {
    return null;
  }

  return {
    kind: cleanString(link?.kind) || "external",
    label: cleanString(link?.label) || url,
    url,
    projectKey: cleanNullableString(link?.projectKey),
    projectSlug: cleanNullableString(link?.projectSlug),
    issueId: cleanNullableString(link?.issueId),
    identifier: cleanNullableString(link?.identifier),
  };
}

function normalizeMissionOutcome(outcome, options = {}) {
  const now = toIsoTimestamp(options.now);
  const key = cleanString(outcome?.key || outcome?.id);
  if (!key) {
    throw new Error("Mission Control outcome is missing key");
  }

  const title = cleanString(outcome?.title);
  if (!title) {
    throw new Error(`Mission Control outcome '${key}' is missing title`);
  }

  const lane = normalizeLane(outcome?.lane, null);
  const missionKey = cleanNullableString(outcome?.missionKey) || key;
  const linkedLinearIdentifiers = uniqueSortedStrings(outcome?.linkedLinearIdentifiers || []);
  const linkedLinearIssueIds = uniqueSortedStrings(outcome?.linkedLinearIssueIds || []);

  if (linkedLinearIdentifiers.length === 0 && linkedLinearIssueIds.length === 0) {
    throw new Error(
      `Mission Control outcome '${key}' must declare linkedLinearIdentifiers or linkedLinearIssueIds`,
    );
  }

  return {
    key,
    missionKey,
    title,
    summary: summarizeDescription(outcome?.summary || outcome?.description || ""),
    lane,
    responsibleAgents: uniqueSortedStrings(
      outcome?.responsibleAgents || deriveResponsibleAgents(lane),
    ),
    linkedLinearIdentifiers,
    linkedLinearIssueIds,
    linkedLinearProjectSlugs: uniqueSortedStrings(outcome?.linkedLinearProjectSlugs || []),
    linkedProjectKeys: uniqueSortedStrings(outcome?.linkedProjectKeys || []),
    notificationPolicy: {
      enabled: outcome?.notificationPolicy?.enabled !== false,
      destinationKey: cleanNullableString(outcome?.notificationPolicy?.destinationKey),
      senderIdentity: cleanNullableString(outcome?.notificationPolicy?.senderIdentity),
    },
    links: (outcome?.links || []).map(normalizeOutcomeLink).filter(Boolean),
    createdAt: toIsoTimestamp(outcome?.createdAt || now),
    updatedAt: toIsoTimestamp(outcome?.updatedAt || now),
  };
}

function deriveResponsibleAgents(lane) {
  switch (lane) {
    case "lane:jon":
      return ["jon"];
    case "lane:mia":
      return ["mia"];
    case "lane:pepper":
      return ["pepper"];
    default:
      return [];
  }
}

function normalizeLinearIssueLifecycle(issueOrState) {
  const rawValue = cleanString(issueOrState).toLowerCase();
  if (
    ["done", "completed", "canceled", "cancelled", "in_progress", "started", "new"].includes(
      rawValue,
    )
  ) {
    if (["done", "completed"].includes(rawValue)) {
      return "done";
    }
    if (["canceled", "cancelled"].includes(rawValue)) {
      return "canceled";
    }
    if (["in_progress", "started"].includes(rawValue)) {
      return "in_progress";
    }
    return "new";
  }

  const state = normalizeSculptedObject(issueOrState?.state ? issueOrState.state : issueOrState);
  const stateType = cleanString(state?.type || issueOrState?.stateType).toLowerCase();
  const stateName = cleanString(
    state?.name || issueOrState?.stateName || issueOrState?.status,
  ).toLowerCase();

  if (["canceled", "cancelled"].includes(stateType) || /cancel/.test(stateName)) {
    return "canceled";
  }

  if (["completed", "done"].includes(stateType) || /(done|complete|closed)/.test(stateName)) {
    return "done";
  }

  if (
    ["started", "in_progress"].includes(stateType) ||
    /(progress|active|review|doing)/.test(stateName)
  ) {
    return "in_progress";
  }

  return "new";
}

function deriveReviewSignals(input = {}) {
  const labelNames = new Set(
    uniqueSortedStrings(input.labelNames || []).map((label) => label.toLowerCase()),
  );
  const stateType = cleanString(input.stateType).toLowerCase();
  const stateName = cleanString(input.stateName || input.status).toLowerCase();
  const explicitRequired = input.humanReviewRequired === true;
  const labelTriggered = [...labelNames].some((label) => HUMAN_REVIEW_LABELS.has(label));
  const awaitingReview =
    stateType === "review" ||
    /(^|\b)(awaiting|needs|pending|in) review(\b|$)/.test(stateName) ||
    /(^|\b)human review(\b|$)/.test(stateName);
  const blockedOnHumanReview =
    (/blocked/.test(stateName) && /review/.test(stateName)) ||
    labelNames.has("blocked-on-human-review") ||
    labelNames.has("blocked_on_human_review") ||
    labelNames.has("blocked on human review");
  const active = explicitRequired || labelTriggered || awaitingReview || blockedOnHumanReview;

  return {
    active,
    awaitingReview,
    blockedOnHumanReview,
  };
}

function deriveHumanReviewState(input = {}) {
  const labelNames = new Set(uniqueSortedStrings(input.labelNames || []));
  const reasons = [];
  const reviewSignals = deriveReviewSignals(input);

  if (reviewSignals.blockedOnHumanReview) {
    reasons.push("blocked-on-human-review");
  } else if (reviewSignals.awaitingReview) {
    reasons.push("awaiting-review");
  }

  if (normalizeRisk(input.risk) === "risk:high") {
    reasons.push("risk:high");
  }
  if (input.externalFacing || labelNames.has("external-facing")) {
    reasons.push("external-facing");
  }
  if (input.irreversible || labelNames.has("irreversible")) {
    reasons.push("irreversible");
  }
  if (input.lowConfidence || labelNames.has("low-confidence")) {
    reasons.push("low-confidence");
  }

  return {
    humanReviewRequired: reviewSignals.active || reasons.length > 0,
    reviewReason:
      reviewSignals.active || reasons.length > 0 ? reasons.join(", ") || "human-review" : null,
    awaitingReview: reviewSignals.awaitingReview,
    blockedOnHumanReview: reviewSignals.blockedOnHumanReview,
  };
}

function deriveCardStatus(input = {}) {
  const issueLifecycles = (input.issueLifecycles || []).map(normalizeLinearIssueLifecycle);
  const hasIssues = issueLifecycles.length > 0;
  const hasDone = issueLifecycles.includes("done");
  const allCanceled = hasIssues && issueLifecycles.every((lifecycle) => lifecycle === "canceled");
  const allTerminal =
    hasIssues &&
    issueLifecycles.every((lifecycle) => lifecycle === "done" || lifecycle === "canceled");
  const hasBlockingDependency = (input.dependencies || []).some(
    (dependency) => dependency.blocking && dependency.status === "open",
  );

  if (allCanceled) {
    return "cancelled";
  }

  if (allTerminal && hasDone) {
    return "completed";
  }

  if (input.humanReviewRequired) {
    return "awaiting_review";
  }

  if (hasBlockingDependency || input.dispatch === "dispatch:blocked") {
    return "blocked";
  }

  if (issueLifecycles.includes("in_progress")) {
    return "in_progress";
  }

  if (input.dispatch === "dispatch:ready") {
    return "ready";
  }

  return "new";
}

function normalizeLatestProof(proof) {
  if (!proof) {
    return null;
  }

  return {
    type: cleanString(proof.type),
    summary: cleanString(proof.summary),
    url: cleanNullableString(proof.url),
    actor: cleanNullableString(proof.actor),
    source: cleanNullableString(proof.source),
    capturedAt: toIsoTimestamp(proof.capturedAt),
  };
}

function normalizeLatestUpdate(update) {
  if (!update) {
    return null;
  }

  return {
    summary: cleanString(update.summary),
    actor: cleanNullableString(update.actor),
    source: cleanNullableString(update.source),
    capturedAt: toIsoTimestamp(update.capturedAt),
  };
}

function normalizeSymphonyTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const projectKey = cleanString(target.projectKey);
  if (!projectKey) {
    return null;
  }

  const port =
    target.port === null || target.port === undefined
      ? null
      : Number.parseInt(String(target.port), 10);

  return {
    projectKey,
    port: Number.isInteger(port) && port > 0 ? port : null,
    probeState: cleanString(target.probeState) || "unknown",
  };
}

function normalizeMasterCard(card, options = {}) {
  const now = toIsoTimestamp(options.now);
  const lane = normalizeLane(card?.lane, null);
  const risk = normalizeRisk(card?.risk);
  const dispatch = normalizeDispatch(card?.dispatch, null);
  const dependencies = (card?.dependencies || []).map(normalizeDependency);
  const humanReviewState = deriveHumanReviewState({
    risk,
    labelNames: card?.source?.labelNames || [],
    externalFacing:
      card?.humanReviewRequired && cleanString(card?.reviewReason).includes("external-facing"),
    irreversible:
      card?.humanReviewRequired && cleanString(card?.reviewReason).includes("irreversible"),
    lowConfidence:
      card?.humanReviewRequired && cleanString(card?.reviewReason).includes("low-confidence"),
  });
  const humanReviewRequired = card?.humanReviewRequired ?? humanReviewState.humanReviewRequired;
  const status = normalizeCardStatus(
    card?.status,
    deriveCardStatus({
      issueLifecycles: card?.source?.issueLifecycles || [],
      humanReviewRequired,
      dependencies,
      dispatch,
    }),
  );

  return {
    id: cleanString(card?.id),
    cardType: cleanString(card?.cardType) || "linear",
    outcomeId: cleanNullableString(card?.outcomeId),
    missionKey: cleanNullableString(card?.missionKey),
    title: cleanString(card?.title),
    summary: cleanString(card?.summary),
    lane,
    responsibleAgents: uniqueSortedStrings(
      card?.responsibleAgents || deriveResponsibleAgents(lane),
    ),
    status,
    risk,
    dispatch,
    originProjects: uniqueSortedStrings(card?.originProjects || []),
    repoTargets: uniqueSortedStrings(card?.repoTargets || []),
    symphonyTargets: (card?.symphonyTargets || [])
      .map(normalizeSymphonyTarget)
      .filter(Boolean)
      .sort((left, right) => left.projectKey.localeCompare(right.projectKey)),
    primaryLinearIssueId: cleanString(card?.primaryLinearIssueId),
    primaryLinearIdentifier: cleanNullableString(card?.primaryLinearIdentifier),
    linkedLinearIssueIds: uniqueSortedStrings(card?.linkedLinearIssueIds || []),
    linkedLinearIdentifiers: uniqueSortedStrings(card?.linkedLinearIdentifiers || []),
    linkedLinearProjectSlugs: uniqueSortedStrings(card?.linkedLinearProjectSlugs || []),
    dependencies,
    latestProof: normalizeLatestProof(card?.latestProof),
    latestUpdate: normalizeLatestUpdate(card?.latestUpdate),
    humanReviewRequired,
    reviewReason: cleanNullableString(card?.reviewReason || humanReviewState.reviewReason),
    alertState: uniqueSortedStrings(card?.alertState || []),
    polling: {
      enabled: Boolean(card?.polling?.enabled),
      intervalMs:
        card?.polling?.intervalMs === null || card?.polling?.intervalMs === undefined
          ? null
          : Number.parseInt(String(card.polling.intervalMs), 10),
      lastSyncAt: cleanNullableString(card?.polling?.lastSyncAt),
      lastErrorAt: cleanNullableString(card?.polling?.lastErrorAt),
      errorCount: Number.parseInt(String(card?.polling?.errorCount || 0), 10) || 0,
    },
    notificationPolicy: {
      enabled: Boolean(card?.notificationPolicy?.enabled),
      destinationKey: cleanNullableString(card?.notificationPolicy?.destinationKey),
      senderIdentity: cleanNullableString(card?.notificationPolicy?.senderIdentity),
    },
    source: {
      type: cleanNullableString(card?.source?.type),
      projectKey: cleanNullableString(card?.source?.projectKey),
      labelNames: uniqueSortedStrings(card?.source?.labelNames || []),
      issueLifecycles: (card?.source?.issueLifecycles || []).map(normalizeLinearIssueLifecycle),
      lastSyncedAt: cleanNullableString(card?.source?.lastSyncedAt),
      linearIssueUpdatedAt: cleanNullableString(card?.source?.linearIssueUpdatedAt),
    },
    createdAt: toIsoTimestamp(card?.createdAt || now),
    updatedAt: toIsoTimestamp(card?.updatedAt || now),
    completedAt: card?.completedAt ? toIsoTimestamp(card.completedAt) : null,
    archivedAt: card?.archivedAt ? toIsoTimestamp(card.archivedAt) : null,
  };
}

function createMasterCardFromLinearIssue(input, options = {}) {
  const issue = normalizeSculptedObject(input?.issue || {});
  const project = input?.project || null;
  const now = toIsoTimestamp(options.now);
  const labelNames = getLabelNames(issue.labels || issue.labelNames);
  const lane = extractLaneFromLabels(labelNames, project?.lane || null);
  const risk = extractRiskFromLabels(labelNames, "risk:low");
  const dispatch = extractDispatchFromLabels(labelNames, null);
  const dependencies = (issue.dependencies || []).map(normalizeDependency);
  const issueLifecycle = normalizeLinearIssueLifecycle(issue);
  const reviewState = deriveHumanReviewState({
    risk,
    labelNames,
    externalFacing: issue.externalFacing,
    irreversible: issue.irreversible,
    lowConfidence: issue.lowConfidence,
  });
  const status = deriveCardStatus({
    issueLifecycles: [issueLifecycle],
    humanReviewRequired: reviewState.humanReviewRequired,
    dependencies,
    dispatch,
  });
  const primaryLinearIssueId = cleanString(issue.id);
  const primaryLinearIdentifier = cleanNullableString(issue.identifier);
  const originProjectKey = cleanNullableString(project?.key);
  const linkedIssueIds = uniqueSortedStrings(
    [primaryLinearIssueId].concat(issue.linkedIssueIds || []).filter(Boolean),
  );
  const linkedIssueIdentifiers = uniqueSortedStrings(
    [primaryLinearIdentifier].concat(issue.linkedIssueIdentifiers || []).filter(Boolean),
  );
  const linkedLinearProjectSlugs = uniqueSortedStrings(
    [project?.linearProjectSlug, issue.project?.slug, issue.projectSlug].filter(Boolean),
  );
  const repoTargets = uniqueSortedStrings([project?.repoPath].filter(Boolean));
  const symphonyTargets = project?.symphonyPort
    ? [
        {
          projectKey: project.key,
          port: project.symphonyPort,
          probeState: "unknown",
        },
      ]
    : [];

  return normalizeMasterCard(
    {
      id: `mc:${primaryLinearIssueId || cleanString(issue.identifier || issue.title || now)}`,
      missionKey: null,
      title: cleanString(issue.title) || primaryLinearIdentifier || primaryLinearIssueId,
      summary: summarizeDescription(issue.description),
      lane,
      responsibleAgents: deriveResponsibleAgents(lane),
      status,
      risk,
      dispatch,
      originProjects: uniqueSortedStrings([originProjectKey].filter(Boolean)),
      repoTargets,
      symphonyTargets,
      primaryLinearIssueId,
      primaryLinearIdentifier,
      linkedLinearIssueIds: linkedIssueIds,
      linkedLinearIdentifiers: linkedIssueIdentifiers,
      linkedLinearProjectSlugs,
      dependencies,
      latestProof: null,
      latestUpdate: null,
      humanReviewRequired: reviewState.humanReviewRequired,
      reviewReason: reviewState.reviewReason,
      alertState: [],
      polling: {
        enabled: false,
        intervalMs: null,
        lastSyncAt: null,
        lastErrorAt: null,
        errorCount: 0,
      },
      notificationPolicy: {
        enabled: false,
        destinationKey: null,
        senderIdentity: null,
      },
      source: {
        type: "linear",
        projectKey: originProjectKey,
        labelNames,
        issueLifecycles: [issueLifecycle],
        lastSyncedAt: now,
        linearIssueUpdatedAt: cleanNullableString(issue.updatedAt),
      },
      createdAt: now,
      updatedAt: now,
      completedAt: issue.completedAt
        ? toIsoTimestamp(issue.completedAt)
        : status === "completed"
          ? now
          : null,
      archivedAt: issue.archivedAt ? toIsoTimestamp(issue.archivedAt) : null,
    },
    { now },
  );
}

module.exports = {
  MISSION_CONTROL_SCHEMA_VERSION,
  VALID_CARD_STATUSES,
  VALID_DISPATCH_STATES,
  VALID_LANES,
  VALID_RISKS,
  createMasterCardFromLinearIssue,
  deriveCardStatus,
  deriveHumanReviewState,
  deriveReviewSignals,
  getLabelNames,
  normalizeAgentIdentity,
  normalizeCardStatus,
  normalizeDependency,
  normalizeDispatch,
  normalizeMissionOutcome,
  normalizeLane,
  normalizeLinearIssueLifecycle,
  normalizeDiscordDestination,
  normalizeMasterCard,
  normalizeOutcomeLink,
  normalizeProjectRegistryEntry,
  normalizeRisk,
  toIsoTimestamp,
  uniqueSortedStrings,
};
