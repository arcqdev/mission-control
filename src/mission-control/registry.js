const VALID_LANES = new Set(["lane:jon", "lane:mia", "lane:pepper"]);

function cleanString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function normalizeLane(value, fallback = null) {
  const candidate = cleanString(value);
  if (VALID_LANES.has(candidate)) {
    return candidate;
  }

  return fallback;
}

function normalizeSymphonyEndpoint(project) {
  const directEndpoint = cleanString(
    project?.symphonyEndpoint || project?.symphonyUrl || project?.runtimeEndpoint,
  );
  if (directEndpoint) {
    try {
      const parsed = new URL(directEndpoint);
      return {
        url: parsed.toString(),
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80,
        path: parsed.pathname || "/health",
        protocol: parsed.protocol || "http:",
      };
    } catch (error) {
      throw new Error(
        `Mission Control project '${cleanString(project?.key)}' has invalid symphonyEndpoint: ${error.message}`,
      );
    }
  }

  if (
    project?.symphonyPort === null ||
    project?.symphonyPort === undefined ||
    project?.symphonyPort === ""
  ) {
    return null;
  }

  const port = Number.parseInt(String(project.symphonyPort), 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(
      `Mission Control project '${cleanString(project?.key)}' has invalid symphonyPort`,
    );
  }

  const protocol = cleanString(project?.symphonyProtocol || "http:").replace(/:?$/, ":");
  const host = cleanString(project?.symphonyHost || "127.0.0.1");
  const path = cleanString(project?.symphonyHealthPath || "/health") || "/health";

  return {
    url: `${protocol}//${host}:${port}${path.startsWith("/") ? path : `/${path}`}`,
    host,
    port,
    path: path.startsWith("/") ? path : `/${path}`,
    protocol,
  };
}

function normalizeProject(project) {
  const key = cleanString(project?.key);
  const linearProjectSlug = cleanString(project?.linearProjectSlug || project?.linearSlug);
  const lane = normalizeLane(project?.lane);

  if (!key) {
    throw new Error("Mission Control project registry entry is missing key");
  }
  if (!linearProjectSlug) {
    throw new Error(`Mission Control project '${key}' is missing linearProjectSlug`);
  }
  if (!lane) {
    throw new Error(`Mission Control project '${key}' is missing a valid lane`);
  }

  return {
    key,
    label: cleanString(project?.label || project?.name) || key,
    linearProjectSlug,
    lane,
    repoPath: cleanString(project?.repoPath) || null,
    symphony: normalizeSymphonyEndpoint(project),
  };
}

function sortByKey(items) {
  return [...items].sort((left, right) => left.key.localeCompare(right.key));
}

function ensureUnique(items, fieldName, collectionName) {
  const seen = new Set();

  for (const item of items) {
    const value = item[fieldName];
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      throw new Error(`Mission Control ${collectionName} has duplicate ${fieldName}: ${value}`);
    }
    seen.add(value);
  }
}

function loadMissionControlRegistry(config = {}) {
  const rawProjects = config.missionControl?.projects || [];
  const projects = sortByKey(rawProjects.map(normalizeProject));

  ensureUnique(projects, "key", "project registry");
  ensureUnique(projects, "linearProjectSlug", "project registry");

  return {
    schemaVersion: 1,
    projectCount: projects.length,
    projects,
  };
}

function buildProjectRegistryIndexes(registry) {
  const projectByKey = new Map();
  const projectByLinearSlug = new Map();

  for (const project of registry.projects || []) {
    projectByKey.set(project.key, project);
    projectByLinearSlug.set(project.linearProjectSlug, project);
  }

  return {
    projectByKey,
    projectByLinearSlug,
  };
}

module.exports = {
  VALID_LANES,
  buildProjectRegistryIndexes,
  loadMissionControlRegistry,
  normalizeLane,
};
