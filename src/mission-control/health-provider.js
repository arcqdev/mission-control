const fs = require("fs");
const path = require("path");

const SNAPSHOT_FILENAME = "symphony-health.json";

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

function summarizeQueue(queue) {
  if (!queue) {
    return null;
  }

  const depth = Number(queue.depth || 0);
  const active = Number(queue.active || 0);
  const pending = Number(queue.pending || 0);
  if (depth === 0 && active === 0 && pending === 0) {
    return "Queue idle";
  }

  return `Queue active=${active}, pending=${pending}, depth=${depth}`;
}

function parseQueue(rawQueue) {
  if (!rawQueue || typeof rawQueue !== "object") {
    return {
      active: 0,
      pending: 0,
      depth: 0,
    };
  }

  const active = Number(rawQueue.active ?? rawQueue.running ?? 0) || 0;
  const pending = Number(rawQueue.pending ?? rawQueue.waiting ?? rawQueue.backlog ?? 0) || 0;
  const depth = Number(rawQueue.depth ?? pending + active) || 0;

  return {
    active,
    pending,
    depth,
  };
}

function normalizeProbePayload(body, response) {
  const runtime = body?.runtime && typeof body.runtime === "object" ? body.runtime : body;
  const queueSource =
    runtime?.queue || runtime?.queues || body?.queue || body?.queues || body?.activity?.queue || {};
  const queue = parseQueue(queueSource);
  const rawStatus = String(
    body?.status || runtime?.status || body?.health?.status || (response.ok ? "ok" : "error"),
  ).toLowerCase();

  let status = "healthy";
  if (!response.ok) {
    status = "unreachable";
  } else if (["error", "down", "unhealthy"].includes(rawStatus)) {
    status = "unreachable";
  } else if (["degraded", "warning", "warn"].includes(rawStatus)) {
    status = "degraded";
  }

  return {
    status,
    reachable: response.ok,
    responseCode: response.status,
    summary: summarizeQueue(queue) || `Runtime status ${rawStatus}`,
    queue,
    rawStatus,
  };
}

function createEmptyProjectState(project) {
  return {
    projectKey: project.key,
    linearProjectSlug: project.linearProjectSlug,
    lane: project.lane,
    symphony: {
      endpoint: project.symphony?.url || null,
      status: project.symphony ? "unknown" : "unconfigured",
      reachable: false,
      responseCode: null,
      summary: project.symphony ? "Probe pending" : "Symphony runtime not configured",
      checkedAt: null,
      lastHealthyAt: null,
      lastError: null,
      queue: {
        active: 0,
        pending: 0,
        depth: 0,
      },
    },
  };
}

function createInitialState(registry, now) {
  return {
    version: 1,
    updatedAt: isoNow(now),
    projects: (registry.projects || []).map(createEmptyProjectState),
  };
}

function createSymphonyHealthProvider({
  registry,
  dataDir,
  now = Date.now,
  logger = console,
  fetchImpl = globalThis.fetch,
  onChange = () => {},
  pollIntervalMs = 30000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  const rootDir = path.join(dataDir, "mission-control");
  const snapshotPath = path.join(rootDir, SNAPSHOT_FILENAME);
  let pollHandle = null;
  let state = createInitialState(registry, now);

  try {
    ensureDir(rootDir);
    if (fs.existsSync(snapshotPath)) {
      const loaded = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
      state = {
        ...state,
        ...loaded,
        projects: Array.isArray(loaded.projects)
          ? loaded.projects.map((project) => ({
              ...createEmptyProjectState(
                registry.projects.find((entry) => entry.key === project.projectKey) || {
                  key: project.projectKey,
                  linearProjectSlug: project.linearProjectSlug,
                  lane: project.lane,
                  symphony: { url: project.symphony?.endpoint || null },
                },
              ),
              ...project,
              symphony: {
                ...createEmptyProjectState({
                  key: project.projectKey,
                  linearProjectSlug: project.linearProjectSlug,
                  lane: project.lane,
                  symphony: { url: project.symphony?.endpoint || null },
                }).symphony,
                ...(project.symphony || {}),
                queue: {
                  active: Number(project.symphony?.queue?.active || 0),
                  pending: Number(project.symphony?.queue?.pending || 0),
                  depth: Number(project.symphony?.queue?.depth || 0),
                },
              },
            }))
          : state.projects,
      };
    }
  } catch (error) {
    logger.warn?.(`[Mission Control] Failed to load Symphony health snapshot: ${error.message}`);
  }

  function persist() {
    state.updatedAt = isoNow(now);
    writeSnapshot(snapshotPath, state);
  }

  async function probeProject(project) {
    const existing =
      state.projects.find((entry) => entry.projectKey === project.key) ||
      createEmptyProjectState(project);

    if (!project.symphony) {
      return existing;
    }

    try {
      const response = await fetchImpl(project.symphony.url, {
        headers: { accept: "application/json" },
      });
      const body = await response.json().catch(() => ({}));
      const parsed = normalizeProbePayload(body, response);
      const checkedAt = isoNow(now);

      return {
        ...existing,
        projectKey: project.key,
        linearProjectSlug: project.linearProjectSlug,
        lane: project.lane,
        symphony: {
          endpoint: project.symphony.url,
          status: parsed.status,
          reachable: parsed.reachable,
          responseCode: parsed.responseCode,
          summary: parsed.summary,
          checkedAt,
          lastHealthyAt:
            parsed.status === "healthy" ? checkedAt : existing.symphony?.lastHealthyAt || null,
          lastError: parsed.status === "healthy" ? null : parsed.rawStatus,
          queue: parsed.queue,
        },
      };
    } catch (error) {
      return {
        ...existing,
        projectKey: project.key,
        linearProjectSlug: project.linearProjectSlug,
        lane: project.lane,
        symphony: {
          endpoint: project.symphony.url,
          status: "unreachable",
          reachable: false,
          responseCode: null,
          summary: `Runtime unreachable: ${error.message}`,
          checkedAt: isoNow(now),
          lastHealthyAt: existing.symphony?.lastHealthyAt || null,
          lastError: error.message,
          queue: existing.symphony?.queue || { active: 0, pending: 0, depth: 0 },
        },
      };
    }
  }

  async function refresh() {
    const projects = [];
    for (const project of registry.projects || []) {
      projects.push(await probeProject(project));
    }
    state = {
      ...state,
      projects,
      updatedAt: isoNow(now),
    };
    persist();
    onChange({ type: "runtime-updated", runtime: getState() });
    return getState();
  }

  function getState() {
    return {
      ...state,
      projects: state.projects.map((project) => ({
        ...project,
        symphony: {
          ...project.symphony,
          queue: { ...(project.symphony?.queue || { active: 0, pending: 0, depth: 0 }) },
        },
      })),
    };
  }

  function start() {
    if (pollHandle || registry.projectCount === 0) {
      return;
    }
    refresh().catch((error) => {
      logger.warn?.(`[Mission Control] Symphony health refresh failed: ${error.message}`);
    });
    pollHandle = setIntervalFn(() => {
      refresh().catch((error) => {
        logger.warn?.(`[Mission Control] Symphony health refresh failed: ${error.message}`);
      });
    }, pollIntervalMs);
  }

  function stop() {
    if (!pollHandle) {
      return;
    }
    clearIntervalFn(pollHandle);
    pollHandle = null;
  }

  return {
    getState,
    refresh,
    start,
    stop,
  };
}

module.exports = {
  createSymphonyHealthProvider,
  normalizeProbePayload,
};
