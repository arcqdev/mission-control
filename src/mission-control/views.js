const fs = require("fs");
const path = require("path");

const VIEWS_FILENAME = "saved-views.json";
const VIEWS_SCHEMA_VERSION = 1;

const DEFAULT_SAVED_VIEWS = Object.freeze([
  {
    id: "today",
    name: "Today",
    builtin: true,
    filters: {
      updatedSinceHours: 24,
      excludeStatuses: ["completed", "cancelled"],
    },
  },
  {
    id: "jon-lane",
    name: "Jon lane",
    builtin: true,
    filters: {
      lane: "lane:jon",
    },
  },
  {
    id: "mia-lane",
    name: "Mia lane",
    builtin: true,
    filters: {
      lane: "lane:mia",
    },
  },
  {
    id: "pepper-blockers",
    name: "Pepper blockers",
    builtin: true,
    filters: {
      lane: "lane:pepper",
      blocked: true,
    },
  },
  {
    id: "needs-review",
    name: "Needs review",
    builtin: true,
    filters: {
      requiresReview: true,
    },
  },
]);

function isoNow(now = Date.now) {
  return new Date(now()).toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sortValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((result, key) => {
        result[key] = sortValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function atomicWriteJson(filePath, value) {
  const dirPath = path.dirname(filePath);
  ensureDir(dirPath);

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(sortValue(value), null, 2)}\n`;

  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}

function normalizeView(view = {}) {
  const id = String(view.id || "").trim();
  if (!id) {
    throw new Error("Mission Control saved view requires an id");
  }

  return {
    id,
    name: String(view.name || id).trim(),
    builtin: view.builtin === true,
    filters: view.filters && typeof view.filters === "object" ? { ...view.filters } : {},
    createdAt: view.createdAt || null,
    updatedAt: view.updatedAt || null,
  };
}

function mergeViews(defaultViews, existingViews, now) {
  const merged = new Map();

  for (const view of defaultViews) {
    const normalized = normalizeView(view);
    merged.set(normalized.id, {
      ...normalized,
      createdAt: normalized.createdAt || now,
      updatedAt: normalized.updatedAt || now,
    });
  }

  for (const view of existingViews || []) {
    const normalized = normalizeView(view);
    const existing = merged.get(normalized.id);
    merged.set(normalized.id, {
      ...existing,
      ...normalized,
      builtin: existing?.builtin || normalized.builtin,
      createdAt: normalized.createdAt || existing?.createdAt || now,
      updatedAt: normalized.updatedAt || existing?.updatedAt || now,
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function createInitialState(now) {
  return {
    schemaVersion: VIEWS_SCHEMA_VERSION,
    updatedAt: now,
    activeViewId: DEFAULT_SAVED_VIEWS[0].id,
    views: mergeViews(DEFAULT_SAVED_VIEWS, [], now),
  };
}

function createMissionControlViewsStore({ dataDir, now = Date.now } = {}) {
  const missionControlDir = path.join(dataDir, "mission-control");
  const filePath = path.join(missionControlDir, VIEWS_FILENAME);
  const currentNow = isoNow(now);

  let state = createInitialState(currentNow);
  ensureDir(missionControlDir);

  if (fs.existsSync(filePath)) {
    try {
      const loaded = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const mergedViews = mergeViews(DEFAULT_SAVED_VIEWS, loaded.views, currentNow);
      const activeViewId = mergedViews.some((view) => view.id === loaded.activeViewId)
        ? loaded.activeViewId
        : mergedViews[0]?.id || DEFAULT_SAVED_VIEWS[0].id;

      state = {
        schemaVersion: VIEWS_SCHEMA_VERSION,
        updatedAt: loaded.updatedAt || currentNow,
        activeViewId,
        views: mergedViews,
      };
    } catch (_error) {
      state = createInitialState(currentNow);
    }
  }

  function persist() {
    state.updatedAt = isoNow(now);
    atomicWriteJson(filePath, state);
  }

  if (!fs.existsSync(filePath)) {
    persist();
  }

  function getState() {
    return {
      schemaVersion: state.schemaVersion,
      updatedAt: state.updatedAt,
      activeViewId: state.activeViewId,
      views: state.views.map((view) => ({ ...view, filters: { ...view.filters } })),
    };
  }

  function setActiveView(viewId) {
    const normalizedId = String(viewId || "").trim();
    if (!state.views.some((view) => view.id === normalizedId)) {
      throw new Error(`Unknown Mission Control view: ${normalizedId}`);
    }

    state.activeViewId = normalizedId;
    persist();
    return getState();
  }

  function upsertView(view) {
    const normalized = normalizeView(view);
    const existingIndex = state.views.findIndex((entry) => entry.id === normalized.id);
    const timestamp = isoNow(now);

    if (existingIndex >= 0) {
      state.views[existingIndex] = {
        ...state.views[existingIndex],
        ...normalized,
        updatedAt: timestamp,
      };
    } else {
      state.views.push({
        ...normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    state.views.sort((left, right) => left.name.localeCompare(right.name));
    persist();
    return getState();
  }

  return {
    getState,
    setActiveView,
    upsertView,
  };
}

function cardMatchesSavedView(card, filters = {}, now = Date.now()) {
  if (filters.lane && card.lane !== filters.lane) {
    return false;
  }

  if (filters.requiresReview && !card.humanReviewRequired) {
    return false;
  }

  if (filters.blocked && !["blocked", "awaiting_review"].includes(card.status)) {
    return false;
  }

  if (Array.isArray(filters.statuses) && filters.statuses.length > 0) {
    if (!filters.statuses.includes(card.status)) {
      return false;
    }
  }

  if (Array.isArray(filters.excludeStatuses) && filters.excludeStatuses.includes(card.status)) {
    return false;
  }

  if (filters.updatedSinceHours) {
    const updatedAt = Date.parse(card.source?.linearIssueUpdatedAt || card.updatedAt || 0);
    const threshold = now - Number(filters.updatedSinceHours) * 60 * 60 * 1000;
    if (!updatedAt || updatedAt < threshold) {
      return false;
    }
  }

  if (filters.search) {
    const haystack = [
      card.title,
      card.summary,
      card.primaryLinearIdentifier,
      ...(card.source?.labelNames || []),
      ...(card.originProjects || []),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(String(filters.search).toLowerCase())) {
      return false;
    }
  }

  return true;
}

module.exports = {
  DEFAULT_SAVED_VIEWS,
  cardMatchesSavedView,
  createMissionControlViewsStore,
};
