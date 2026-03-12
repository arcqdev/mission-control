const fs = require("fs");
const os = require("os");
const path = require("path");

const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const RECENT_WINDOW_MS = 60 * 60 * 1000;
const CACHE_TTL_MS = 15000;
const RECENT_SESSION_LIMIT = 18;
const AGENT_SESSION_PREVIEW_LIMIT = 6;

function createEmptyTranscriptSummary() {
  return {
    messageCount: 0,
    toolCalls: 0,
    totalTokens: 0,
    preview: "",
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function formatHomePath(filePath) {
  const homeDir = os.homedir();
  if (typeof filePath !== "string" || !filePath) {
    return null;
  }

  if (filePath.startsWith(homeDir + path.sep)) {
    return filePath.replace(homeDir, "~");
  }

  return filePath;
}

function toIsoTimestamp(value) {
  const timestamp =
    typeof value === "number" && Number.isFinite(value)
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function formatRelativeAge(ageMs) {
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "never";
  }

  if (ageMs < 60 * 1000) {
    return "just now";
  }

  const totalMinutes = Math.floor(ageMs / 60000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m ago`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    return `${totalHours}h ago`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${totalDays}d ago`;
}

function deriveStatus(ageMs) {
  if (ageMs <= ACTIVE_WINDOW_MS) {
    return "active";
  }
  if (ageMs <= RECENT_WINDOW_MS) {
    return "recent";
  }
  return "idle";
}

function parseJsonOutput(rawOutput, extractJSON) {
  if (!rawOutput) {
    return null;
  }

  const jsonPayload = typeof extractJSON === "function" ? extractJSON(rawOutput) : rawOutput;
  if (!jsonPayload) {
    return null;
  }

  try {
    return JSON.parse(jsonPayload);
  } catch (_error) {
    return null;
  }
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function inferChannel(sessionKey, entry) {
  const deliveryChannel =
    entry?.channel ||
    entry?.lastChannel ||
    entry?.deliveryContext?.channel ||
    entry?.origin?.surface ||
    entry?.origin?.provider;

  if (deliveryChannel) {
    return deliveryChannel;
  }

  if (sessionKey.includes(":discord:")) return "discord";
  if (sessionKey.includes(":telegram:")) return "telegram";
  if (sessionKey.includes(":slack:")) return "slack";
  if (sessionKey.includes(":signal:")) return "signal";
  if (sessionKey.includes(":whatsapp:")) return "whatsapp";
  if (sessionKey.includes(":cron:")) return "cron";
  if (sessionKey.includes(":subagent:")) return "subagent";
  return "other";
}

function sortCountEntries(entries) {
  return entries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }
    return String(left.key).localeCompare(String(right.key));
  });
}

function addCount(map, key, label, amount = 1) {
  if (!key) {
    return;
  }

  const current = map.get(key) || { key, label: label || key, count: 0 };
  current.count += amount;
  map.set(key, current);
}

function resolveModelLabel(agent, entry) {
  if (entry?.providerOverride && entry?.modelOverride) {
    return `${entry.providerOverride}/${entry.modelOverride}`;
  }

  if (entry?.modelOverride) {
    return entry.modelOverride;
  }

  return agent?.model || null;
}

function createTranscriptSummary(filePath, transcriptCache) {
  if (!filePath || !fs.existsSync(filePath)) {
    return createEmptyTranscriptSummary();
  }

  try {
    const stat = fs.statSync(filePath);
    const cached = transcriptCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.summary;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    const summary = createEmptyTranscriptSummary();
    let lastAssistantText = "";
    let lastUserText = "";

    for (const line of lines) {
      let entry = null;
      try {
        entry = JSON.parse(line);
      } catch (_error) {
        continue;
      }

      if (entry?.type !== "message" || !entry.message) {
        continue;
      }

      const message = entry.message;
      if (message.role) {
        summary.messageCount += 1;
      }

      if (message.usage) {
        const inputTokens = message.usage.input || message.usage.inputTokens || 0;
        const outputTokens = message.usage.output || message.usage.outputTokens || 0;
        const cacheRead = message.usage.cacheRead || message.usage.cacheReadTokens || 0;
        const cacheWrite = message.usage.cacheWrite || message.usage.cacheWriteTokens || 0;
        summary.totalTokens += inputTokens + outputTokens + cacheRead + cacheWrite;
      }

      let text = "";
      if (typeof message.content === "string") {
        text = message.content;
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part?.type === "text" && part.text) {
            text = part.text;
          }
          if (part?.type === "toolCall" || part?.type === "tool_use") {
            summary.toolCalls += 1;
          }
        }
      }

      if (message.role === "assistant" && text) {
        lastAssistantText = text;
      } else if (message.role === "user" && text) {
        lastUserText = text;
      }
    }

    summary.preview = (lastAssistantText || lastUserText || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean)
      ?.slice(0, 180) || "";

    transcriptCache.set(filePath, {
      mtimeMs: stat.mtimeMs,
      summary,
    });

    return summary;
  } catch (_error) {
    return createEmptyTranscriptSummary();
  }
}

function summarizeAuthProfiles(authProfiles) {
  const profiles = normalizeObject(authProfiles?.profiles);
  const usageStats = normalizeObject(authProfiles?.usageStats);
  const lastGood = normalizeObject(authProfiles?.lastGood);
  const providers = new Map();
  let lastUsedAt = null;

  for (const [profileKey, profile] of Object.entries(profiles)) {
    const providerKey = profile?.provider || profileKey.split(":")[0] || "unknown";
    const providerEntry = providers.get(providerKey) || {
      provider: providerKey,
      profileCount: 0,
      types: new Set(),
      isLastGood: false,
      lastUsedAt: null,
    };

    providerEntry.profileCount += 1;
    if (profile?.type) {
      providerEntry.types.add(profile.type);
    }

    if (lastGood[providerKey] === profileKey) {
      providerEntry.isLastGood = true;
    }

    const usedAt = usageStats[profileKey]?.lastUsed || null;
    if (usedAt && (!providerEntry.lastUsedAt || usedAt > providerEntry.lastUsedAt)) {
      providerEntry.lastUsedAt = usedAt;
    }
    if (usedAt && (!lastUsedAt || usedAt > lastUsedAt)) {
      lastUsedAt = usedAt;
    }

    providers.set(providerKey, providerEntry);
  }

  return {
    profileCount: Object.keys(profiles).length,
    providerCount: providers.size,
    lastUsedAt: toIsoTimestamp(lastUsedAt),
    providers: Array.from(providers.values())
      .map((provider) => ({
        provider: provider.provider,
        profileCount: provider.profileCount,
        types: Array.from(provider.types).sort(),
        isLastGood: provider.isLastGood,
        lastUsedAt: toIsoTimestamp(provider.lastUsedAt),
      }))
      .sort((left, right) => left.provider.localeCompare(right.provider)),
  };
}

function summarizeModelCatalog(modelsConfig) {
  const providers = normalizeObject(modelsConfig?.providers);
  const catalogProviders = [];
  const modelMap = new Map();

  for (const [providerKey, provider] of Object.entries(providers)) {
    const models = normalizeArray(provider?.models);
    catalogProviders.push({
      provider: providerKey,
      modelCount: models.length,
    });

    for (const model of models) {
      if (!model?.id) {
        continue;
      }

      modelMap.set(model.id, {
        id: model.id,
        name: model.name || model.id,
        provider: providerKey,
        contextWindow: model.contextWindow || null,
      });
    }
  }

  return {
    providerCount: catalogProviders.length,
    modelCount: modelMap.size,
    providers: catalogProviders.sort((left, right) => left.provider.localeCompare(right.provider)),
    models: Array.from(modelMap.values()).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function normalizeSessionEntries(sessionsIndex) {
  if (Array.isArray(sessionsIndex?.sessions)) {
    return sessionsIndex.sessions.map((entry) => [entry.key, entry]);
  }

  if (sessionsIndex && typeof sessionsIndex === "object") {
    return Object.entries(sessionsIndex);
  }

  return [];
}

function createAcpModule(deps) {
  const { getOpenClawDir, runOpenClaw, extractJSON, parseSessionLabel } = deps;

  let cachedActivity = null;
  let lastUpdatedAt = 0;
  const transcriptCache = new Map();

  function readConfiguredAgents() {
    const payload = parseJsonOutput(runOpenClaw("agents list --json"), extractJSON);
    return Array.isArray(payload) ? payload : [];
  }

  function readAgentBindings() {
    const payload = parseJsonOutput(runOpenClaw("agents bindings --json"), extractJSON);
    return Array.isArray(payload) ? payload : [];
  }

  function buildAgentActivity(agent, bindingsByAgent, currentTime) {
    const openclawDir = getOpenClawDir();
    const agentId = agent?.id || "unknown";
    const sessionIndexPath = path.join(openclawDir, "agents", agentId, "sessions", "sessions.json");
    const authProfilesPath = path.join(openclawDir, "agents", agentId, "agent", "auth-profiles.json");
    const modelsPath = path.join(openclawDir, "agents", agentId, "agent", "models.json");
    const sessionEntries = normalizeSessionEntries(readJsonFile(sessionIndexPath, {}));
    const channelCounts = new Map();
    const modelCounts = new Map();
    const skillCounts = new Map();
    const recentSessions = [];
    let activeSessions = 0;
    let recentSessionsCount = 0;
    let idleSessions = 0;
    let totalMessages = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastActivityAt = null;

    for (const [sessionKey, rawEntry] of sessionEntries) {
      const entry = normalizeObject(rawEntry);
      const updatedAtMs = Number(entry.updatedAt || 0);
      const ageMs = updatedAtMs > 0 ? Math.max(0, currentTime - updatedAtMs) : Number.POSITIVE_INFINITY;
      const status = deriveStatus(ageMs);
      const sessionFile = entry.sessionFile || null;
      const transcriptSummary = createTranscriptSummary(sessionFile, transcriptCache);
      const sessionLabel =
        entry.groupChannel ||
        entry.displayName ||
        (typeof parseSessionLabel === "function" ? parseSessionLabel(sessionKey) : sessionKey);
      const channel = inferChannel(sessionKey, entry);
      const model = resolveModelLabel(agent, entry);
      const skills = normalizeArray(entry.skillsSnapshot?.skills)
        .map((skill) => skill?.name)
        .filter(Boolean);

      if (status === "active") {
        activeSessions += 1;
      } else if (status === "recent") {
        recentSessionsCount += 1;
      } else {
        idleSessions += 1;
      }

      if (updatedAtMs && (!lastActivityAt || updatedAtMs > lastActivityAt)) {
        lastActivityAt = updatedAtMs;
      }

      addCount(channelCounts, channel, channel.toUpperCase());
      addCount(modelCounts, model || "unknown", model || "Unknown");
      skills.forEach((skillName) => addCount(skillCounts, skillName, skillName));

      totalMessages += transcriptSummary.messageCount;
      totalToolCalls += transcriptSummary.toolCalls;
      totalTokens += transcriptSummary.totalTokens;

      recentSessions.push({
        agentId,
        sessionKey,
        sessionId: entry.sessionId || null,
        label: sessionLabel,
        channel,
        chatType: entry.chatType || entry.origin?.chatType || "direct",
        accountId: entry.lastAccountId || entry.deliveryContext?.accountId || entry.origin?.accountId || null,
        status,
        ageMs,
        ageLabel: formatRelativeAge(ageMs),
        updatedAt: toIsoTimestamp(updatedAtMs),
        model: model || "unknown",
        messageCount: transcriptSummary.messageCount,
        toolCalls: transcriptSummary.toolCalls,
        totalTokens: transcriptSummary.totalTokens,
        preview: transcriptSummary.preview,
      });
    }

    recentSessions.sort((left, right) => left.ageMs - right.ageMs);

    const authProfiles = readJsonFile(authProfilesPath, {});
    const modelsConfig = readJsonFile(modelsPath, {});
    const bindings = normalizeArray(bindingsByAgent.get(agentId)).map((binding) => ({
      description: binding.description || "Unlabeled binding",
      channel: binding.match?.channel || null,
      accountId: binding.match?.accountId || null,
    }));

    const stats = {
      totalSessions: sessionEntries.length,
      activeSessions,
      recentSessions: recentSessionsCount,
      idleSessions,
      totalMessages,
      totalToolCalls,
      totalTokens,
      lastActivityAt: toIsoTimestamp(lastActivityAt),
      lastActivityLabel: formatRelativeAge(
        lastActivityAt ? Math.max(0, currentTime - lastActivityAt) : Number.POSITIVE_INFINITY,
      ),
    };

    return {
      id: agentId,
      name: agent?.name || agentId,
      isDefault: Boolean(agent?.isDefault),
      configuredModel: agent?.model || null,
      workspace: formatHomePath(agent?.workspace || null),
      workspaceLabel: agent?.workspace ? path.basename(agent.workspace) : null,
      agentDir: formatHomePath(agent?.agentDir || null),
      routes: normalizeArray(agent?.routes),
      bindings,
      auth: summarizeAuthProfiles(authProfiles),
      modelCatalog: summarizeModelCatalog(modelsConfig),
      stats,
      channels: sortCountEntries(Array.from(channelCounts.values())),
      models: sortCountEntries(Array.from(modelCounts.values())),
      skills: sortCountEntries(Array.from(skillCounts.values())),
      recentSessions: recentSessions.slice(0, AGENT_SESSION_PREVIEW_LIMIT),
      activityState:
        activeSessions > 0
          ? "active"
          : recentSessionsCount > 0
            ? "recent"
            : sessionEntries.length > 0
              ? "idle"
              : "dormant",
    };
  }

  function buildSummary(agents, recentSessions) {
    const channelCounts = new Map();
    const modelCounts = new Map();
    const skillCounts = new Map();
    let activeAgents = 0;
    let recentAgents = 0;
    let idleAgents = 0;
    let totalBindings = 0;
    let totalSessions = 0;
    let activeSessions = 0;
    let recentSessionCount = 0;
    let totalMessages = 0;
    let totalToolCalls = 0;
    let totalTokens = 0;
    let lastActivityAt = null;

    for (const agent of agents) {
      totalBindings += agent.bindings.length;
      totalSessions += agent.stats.totalSessions;
      activeSessions += agent.stats.activeSessions;
      recentSessionCount += agent.stats.recentSessions;
      totalMessages += agent.stats.totalMessages;
      totalToolCalls += agent.stats.totalToolCalls;
      totalTokens += agent.stats.totalTokens;

      if (agent.activityState === "active") {
        activeAgents += 1;
      } else if (agent.activityState === "recent") {
        recentAgents += 1;
      } else {
        idleAgents += 1;
      }

      const activityTimestamp = agent.stats.lastActivityAt
        ? Date.parse(agent.stats.lastActivityAt)
        : null;
      if (activityTimestamp && (!lastActivityAt || activityTimestamp > lastActivityAt)) {
        lastActivityAt = activityTimestamp;
      }

      agent.channels.forEach((entry) => addCount(channelCounts, entry.key, entry.label, entry.count));
      agent.models.forEach((entry) => addCount(modelCounts, entry.key, entry.label, entry.count));
      agent.skills.forEach((entry) => addCount(skillCounts, entry.key, entry.label, entry.count));
    }

    return {
      totalAgents: agents.length,
      activeAgents,
      recentAgents,
      idleAgents,
      totalBindings,
      totalSessions,
      activeSessions,
      recentSessions: recentSessionCount,
      totalMessages,
      totalToolCalls,
      totalTokens,
      lastActivityAt: toIsoTimestamp(lastActivityAt),
      channels: sortCountEntries(Array.from(channelCounts.values())).slice(0, 8),
      models: sortCountEntries(Array.from(modelCounts.values())).slice(0, 8),
      skills: sortCountEntries(Array.from(skillCounts.values())).slice(0, 12),
      mostRecentSessions: recentSessions.slice(0, 6),
    };
  }

  function getAgentActivity() {
    const currentTime = Date.now();
    if (cachedActivity && currentTime - lastUpdatedAt < CACHE_TTL_MS) {
      return cachedActivity;
    }

    const configuredAgents = readConfiguredAgents();
    const bindingsByAgent = new Map();

    for (const binding of readAgentBindings()) {
      const agentBindings = bindingsByAgent.get(binding.agentId) || [];
      agentBindings.push(binding);
      bindingsByAgent.set(binding.agentId, agentBindings);
    }

    const agents = configuredAgents
      .map((agent) => buildAgentActivity(agent, bindingsByAgent, currentTime))
      .sort((left, right) => {
        const stateOrder = { active: 0, recent: 1, idle: 2, dormant: 3 };
        const leftOrder = stateOrder[left.activityState] ?? 99;
        const rightOrder = stateOrder[right.activityState] ?? 99;
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        if (left.isDefault !== right.isDefault) {
          return left.isDefault ? -1 : 1;
        }
        const leftActivity = left.stats.lastActivityAt ? Date.parse(left.stats.lastActivityAt) : 0;
        const rightActivity = right.stats.lastActivityAt
          ? Date.parse(right.stats.lastActivityAt)
          : 0;
        return rightActivity - leftActivity;
      });

    const recentSessions = agents
      .flatMap((agent) =>
        agent.recentSessions.map((session) => ({
          ...session,
          agentName: agent.name,
          agentState: agent.activityState,
        })),
      )
      .sort((left, right) => left.ageMs - right.ageMs)
      .slice(0, RECENT_SESSION_LIMIT);

    cachedActivity = {
      generatedAt: new Date(currentTime).toISOString(),
      summary: buildSummary(agents, recentSessions),
      agents,
      recentSessions,
    };
    lastUpdatedAt = currentTime;
    return cachedActivity;
  }

  function invalidateCache() {
    lastUpdatedAt = 0;
  }

  return {
    getAgentActivity,
    invalidateCache,
  };
}

module.exports = {
  createAcpModule,
};
