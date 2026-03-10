const os = require("os");

const DEFAULT_PROJECT_REGISTRY = Object.freeze([
  {
    key: "littlebrief",
    repoPath: "~/dev/arcqdev/littlebrief",
    linearProjectSlug: "0c92ed8e2c84",
    lane: "lane:jon",
    symphonyPort: 45123,
  },
  {
    key: "lobster-list",
    repoPath: "~/dev/arcqdev/lobster-list",
    linearProjectSlug: "b4deb8dc42ef",
    lane: "lane:jon",
    symphonyPort: 45124,
  },
  {
    key: "usecase4claw-execution",
    repoPath: "~/dev/arcqdev/usecase4claw",
    linearProjectSlug: "3237d374634d",
    lane: "lane:jon",
    symphonyPort: 45125,
  },
  {
    key: "usecase4claw-growth",
    repoPath: "~/dev/arcqdev/usecase4claw",
    linearProjectSlug: "fce22723ee3a",
    lane: "lane:mia",
    symphonyPort: null,
  },
]);

const {
  MISSION_CONTROL_SCHEMA_VERSION,
  normalizeAgentIdentity,
  normalizeDiscordDestination,
  normalizeMissionOutcome,
  normalizeProjectRegistryEntry,
  toIsoTimestamp,
} = require("./models");

const DEFAULT_AGENT_IDENTITIES = Object.freeze([
  {
    key: "jon",
    displayName: "Jon",
    defaultLane: "lane:jon",
    defaultNotificationProfile: "jon",
    heartbeatSources: ["symphony"],
  },
  {
    key: "mia",
    displayName: "Mia",
    defaultLane: "lane:mia",
    defaultNotificationProfile: "mia",
    heartbeatSources: ["proof"],
  },
  {
    key: "pepper",
    displayName: "Pepper",
    defaultLane: "lane:pepper",
    defaultNotificationProfile: "pepper",
    heartbeatSources: ["dispatch"],
  },
]);

function sortByKey(items) {
  return [...items].sort((left, right) => left.key.localeCompare(right.key));
}

function ensureUnique(items, fieldName, collectionName) {
  const seen = new Set();

  for (const item of items) {
    const value = item[fieldName];
    if (seen.has(value)) {
      throw new Error(`Mission Control ${collectionName} has duplicate ${fieldName}: ${value}`);
    }
    seen.add(value);
  }
}

function loadMissionControlRegistry(config = {}, options = {}) {
  const now = toIsoTimestamp(options.now);
  const missionControlConfig = config.missionControl || {};
  const rawProjects =
    missionControlConfig.projects?.length || missionControlConfig.projectRegistry?.length
      ? missionControlConfig.projects || missionControlConfig.projectRegistry
      : DEFAULT_PROJECT_REGISTRY;
  const rawAgents =
    missionControlConfig.agents && missionControlConfig.agents.length > 0
      ? missionControlConfig.agents
      : DEFAULT_AGENT_IDENTITIES;
  const rawDiscordDestinations = missionControlConfig.discordDestinations || [];
  const rawOutcomes = missionControlConfig.outcomes || missionControlConfig.missions || [];

  const projects = sortByKey(
    rawProjects.map((project) => normalizeProjectRegistryEntry(project, { now })),
  );
  const agents = sortByKey(rawAgents.map((agent) => normalizeAgentIdentity(agent, { now })));
  const discordDestinations = sortByKey(
    rawDiscordDestinations.map((destination) => normalizeDiscordDestination(destination)),
  );
  const outcomes = sortByKey(
    rawOutcomes.map((outcome) => normalizeMissionOutcome(outcome, { now })),
  );

  ensureUnique(projects, "key", "project registry");
  ensureUnique(projects, "linearProjectSlug", "project registry");
  ensureUnique(agents, "key", "agent registry");
  ensureUnique(discordDestinations, "key", "Discord destinations");
  ensureUnique(outcomes, "key", "outcomes");
  ensureUnique(outcomes, "missionKey", "outcomes");

  return {
    schemaVersion: MISSION_CONTROL_SCHEMA_VERSION,
    projectCount: projects.length,
    outcomeCount: outcomes.length,
    createdAt: now,
    updatedAt: now,
    host: os.hostname(),
    projects,
    agents,
    discordDestinations,
    outcomes,
  };
}

function buildProjectRegistryIndexes(registry) {
  const projectByKey = new Map();
  const projectByLinearSlug = new Map();

  for (const project of registry.projects || []) {
    projectByKey.set(project.key, project);
    projectByLinearSlug.set(project.linearProjectSlug, project);
  }

  return { projectByKey, projectByLinearSlug };
}

module.exports = {
  DEFAULT_AGENT_IDENTITIES,
  DEFAULT_PROJECT_REGISTRY,
  buildProjectRegistryIndexes,
  loadMissionControlRegistry,
};
