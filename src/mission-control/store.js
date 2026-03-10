const fs = require("fs");
const path = require("path");

function ensureMissionControlDir(dataDir) {
  const missionControlDir = path.join(dataDir, "mission-control");
  fs.mkdirSync(missionControlDir, { recursive: true });
  return missionControlDir;
}

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (_error) {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
}

function createMissionControlStore(dataDir) {
  const missionControlDir = ensureMissionControlDir(dataDir);
  const notificationsPath = path.join(missionControlDir, "notifications.json");

  return {
    notificationsPath,
    readNotifications(fallback) {
      return readJsonFile(notificationsPath, fallback);
    },
    writeNotifications(value) {
      writeJsonFileAtomic(notificationsPath, value);
    },
  };
}

module.exports = {
  createMissionControlStore,
  ensureMissionControlDir,
  readJsonFile,
  writeJsonFileAtomic,
};
