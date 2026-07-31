const os = require("node:os");
const path = require("node:path");

async function resolveTrackerPaths({ home = os.homedir() } = {}) {
  const stateHome =
    typeof process.env.TRUSTTOOLS_TOKENTRACKER_STATE_HOME === "string" &&
    process.env.TRUSTTOOLS_TOKENTRACKER_STATE_HOME.trim()
      ? process.env.TRUSTTOOLS_TOKENTRACKER_STATE_HOME.trim()
      : home;
  const rootDir = path.join(stateHome, ".tokentracker");
  return {
    rootDir,
    trackerDir: path.join(rootDir, "tracker"),
    binDir: path.join(rootDir, "bin"),
    cacheDir: path.join(rootDir, "cache"),
  };
}

module.exports = {
  resolveTrackerPaths,
};
