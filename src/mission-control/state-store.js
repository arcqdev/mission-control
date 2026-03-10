const fs = require("fs");
const path = require("path");

const SNAPSHOT_FILENAME = "mission-control-state.json";

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

function createMissionControlStateStore({ dataDir, now = Date.now, logger = console }) {
  const rootDir = path.join(dataDir, "mission-control");
  const snapshotPath = path.join(rootDir, SNAPSHOT_FILENAME);
  let state = null;

  try {
    ensureDir(rootDir);
    if (fs.existsSync(snapshotPath)) {
      state = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    }
  } catch (error) {
    logger.warn?.(`[Mission Control] Failed to load persisted state snapshot: ${error.message}`);
  }

  function update(publicState) {
    state = {
      version: 1,
      persistedAt: isoNow(now),
      ...publicState,
    };
    writeSnapshot(snapshotPath, state);
    return getState();
  }

  function getState() {
    return state ? JSON.parse(JSON.stringify(state)) : null;
  }

  return {
    getState,
    update,
  };
}

module.exports = {
  createMissionControlStateStore,
};
