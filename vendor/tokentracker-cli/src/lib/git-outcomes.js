"use strict";

// Conservative, metadata-only Git attribution. A commit is attributed only
// when exactly one local AI session overlaps its author timestamp.

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function resolveAutoOutcomesPath(home = os.homedir()) {
  return path.join(home, ".tokentracker", "tracker", "auto-outcomes.jsonl");
}

function readJsonl(filePath) {
  try { return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); }
  catch { return []; }
}

// Async on purpose: this runs inside the local API request path, where a
// synchronous spawn would freeze every other endpoint for the duration of
// each git invocation.
function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => resolve(error ? "" : String(stdout).trim()),
    );
  });
}

async function repoRoot(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return null;
  return (await runGit(cwd, ["rev-parse", "--show-toplevel"])) || null;
}

async function commitsForWindow(root, from, to) {
  const format = "%H%x1f%aI%x1f%P%x1f%s%x1e";
  const raw = await runGit(root, ["log", "--all", `--since=${from}`, `--until=${to}`, `--format=${format}`]);
  if (!raw) return [];
  return raw.split("\x1e").map((item) => item.trim()).filter(Boolean).map((item) => {
    const [sha, timestamp, parents, subject] = item.split("\x1f");
    return {
      sha,
      timestamp,
      parent_count: String(parents || "").split(/\s+/).filter(Boolean).length,
      reverted: /^revert\b/i.test(subject || ""),
    };
  }).filter((row) => row.sha && Number.isFinite(Date.parse(row.timestamp)));
}

async function writeAtomic(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temp, filePath);
}

// Attribution walks into the working directory of every recent session and
// runs git there. On macOS each distinct protected location that gets touched
// (~/Documents, ~/Downloads, another app's container) raises its own TCC
// consent prompt, so probing must happen only when there is new work to
// attribute — never on every dashboard poll.
const GIT_PROBE_TTL_MS = 30 * 60 * 1000;

// A data-only fingerprint of the sessions we would attribute. Computing it
// touches no filesystem and spawns no git, so an unchanged fingerprint lets us
// serve the cached sidecar without entering a single project directory.
function sessionsFingerprint(sessions, maxAgeDays) {
  const hash = crypto.createHash("sha256");
  hash.update(`v1\0${maxAgeDays}\n`);
  const rows = sessions.map(
    (session) => `${session.project_ref}\0${session.session_hash}\0${session.started_at}\0${session.ended_at}`,
  );
  for (const row of rows.sort()) hash.update(`${row}\n`);
  return hash.digest("hex");
}

// The sessions attribution is allowed to look at. Filtering here — before the
// fingerprint and before any filesystem access — keeps the cache signature and
// the probe set in agreement, so a skipped directory is never entered and never
// invalidates the cache either.
function attributableSessions(sessions, cutoff, home) {
  const kept = [];
  for (const session of sessions || []) {
    if (!session?.project_ref || !session.started_at || !session.ended_at) continue;
    if (Date.parse(session.ended_at) < cutoff) continue;
    if (isTccProtectedPath(session.project_ref, home)) continue;
    kept.push(session);
  }
  return kept;
}

function gitAttributionDisabled() {
  return ["1", "true"].includes(String(process.env.TOKENTRACKER_DISABLE_GIT_ATTRIBUTION || "").toLowerCase());
}

// macOS gates these locations behind TCC: the first access to each one raises
// its own "TokenTracker would like to access data in …" consent dialog, and
// ad-hoc signing resets that consent on every update, so the dialogs come back
// each time. Attribution is an opt-in beta that walks into whatever directory a
// session happened to run in — a token tracker has no business making the OS
// ask for ~/Documents. Skip these by default; anyone who keeps repos there can
// opt back in and answer the prompts knowingly.
const TCC_PROTECTED_HOME_DIRS = ["Documents", "Downloads", "Desktop", "Movies", "Music", "Pictures", "Library"];

function protectedProbeAllowed() {
  return ["1", "true"].includes(String(process.env.TOKENTRACKER_GIT_ATTRIBUTION_PROTECTED_DIRS || "").toLowerCase());
}

function isTccProtectedPath(target, home) {
  if (process.platform !== "darwin" || protectedProbeAllowed()) return false;
  const resolved = path.resolve(String(target || ""));
  if (resolved === "/Volumes" || resolved.startsWith("/Volumes/")) return true;
  const base = path.resolve(String(home || ""));
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) return false;
  const [first] = path.relative(base, resolved).split(path.sep);
  return TCC_PROTECTED_HOME_DIRS.includes(first);
}

async function buildGitOutcomesInternal(sessions, { home = os.homedir(), force = false, maxAgeDays = 90 } = {}) {
  const outputPath = resolveAutoOutcomesPath(home);
  const metaPath = `${outputPath}.meta.json`;
  const cutoff = Date.now() - Math.max(1, Number(maxAgeDays) || 90) * 86400_000;

  // Escape hatch for anyone who would rather keep TokenTracker out of their
  // project directories entirely. Serves whatever was already attributed.
  if (gitAttributionDisabled()) return readJsonl(outputPath);

  // Cheap gate, before any filesystem access: same sessions as last time and
  // the last probe is recent, so there is nothing new to attribute.
  const candidates = attributableSessions(sessions, cutoff, home);
  const sessionSignature = sessionsFingerprint(candidates, maxAgeDays);
  if (!force) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const age = Date.now() - Date.parse(meta.generated_at || "");
      if (
        meta.version === 2
        && meta.session_signature === sessionSignature
        && Number.isFinite(age)
        && age >= 0
        && age < GIT_PROBE_TTL_MS
      ) {
        return readJsonl(outputPath);
      }
    } catch { /* first run, or a v1 sidecar written before this gate existed */ }
  }

  const groups = new Map();
  const rootCache = new Map();
  for (const session of candidates) {
    let root = rootCache.get(session.project_ref);
    if (root === undefined) {
      root = await repoRoot(session.project_ref);
      rootCache.set(session.project_ref, root);
    }
    if (!root) continue;
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(session);
  }

  const signatureHash = crypto.createHash("sha256");
  for (const [root, repoSessions] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    signatureHash.update(`${root}\0${await runGit(root, ["for-each-ref", "--format=%(objectname)"])}\n`);
    for (const session of repoSessions) signatureHash.update(`${session.session_hash}\0${session.ended_at}\n`);
  }
  const signature = signatureHash.digest("hex");
  if (!force) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      // Git state is unchanged too — refresh the timestamp so the cheap gate
      // above can short-circuit the next poll instead of re-probing.
      if (meta.signature === signature) {
        await writeAtomic(metaPath, `${JSON.stringify({ ...meta, version: 2, session_signature: sessionSignature, generated_at: new Date().toISOString() })}\n`);
        return readJsonl(outputPath);
      }
    } catch { /* first run */ }
  }

  const outcomes = [];
  for (const [root, repoSessions] of groups) {
    const start = repoSessions.reduce((min, row) => !min || row.started_at < min ? row.started_at : min, "");
    const endMs = Math.max(...repoSessions.map((row) => Date.parse(row.ended_at))) + 60 * 60 * 1000;
    const commits = await commitsForWindow(root, start, new Date(endMs).toISOString());
    for (const commit of commits) {
      const commitMs = Date.parse(commit.timestamp);
      const candidates = repoSessions.filter((session) => {
        const sessionStart = Date.parse(session.started_at) - 10 * 60 * 1000;
        const sessionEnd = Date.parse(session.ended_at) + 60 * 60 * 1000;
        return commitMs >= sessionStart && commitMs <= sessionEnd;
      });
      if (candidates.length !== 1) continue;
      const session = candidates[0];
      outcomes.push({
        timestamp: commit.timestamp,
        model: session.model || "unknown",
        tool: session.source || "unknown",
        accepted: !commit.reverted,
        task_type: "git_commit",
        status: commit.reverted ? "reverted" : "committed",
        session_hash: session.session_hash,
        commit_hash: commit.sha.slice(0, 12),
        parent_count: commit.parent_count,
        confidence: "heuristic",
        methodology: "single-overlapping-session",
      });
    }
  }
  outcomes.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  await writeAtomic(outputPath, outcomes.map((row) => JSON.stringify(row)).join("\n") + (outcomes.length ? "\n" : ""));
  await writeAtomic(metaPath, `${JSON.stringify({
    version: 2,
    signature,
    session_signature: sessionSignature,
    generated_at: new Date().toISOString(),
    max_age_days: maxAgeDays,
  })}\n`);
  return outcomes;
}

// Overlapping outcomes/session-insights requests must not spawn duplicate git
// scans nor race the atomic sidecar write; share one build per home.
const gitOutcomesBuilds = new Map();

function buildGitOutcomes(sessions, options = {}) {
  const home = path.resolve(String(options.home || os.homedir()));
  const existing = gitOutcomesBuilds.get(home);
  if (existing) return existing;
  const promise = buildGitOutcomesInternal(sessions, { ...options, home });
  gitOutcomesBuilds.set(home, promise);
  const clear = () => {
    if (gitOutcomesBuilds.get(home) === promise) gitOutcomesBuilds.delete(home);
  };
  promise.then(clear, clear);
  return promise;
}

module.exports = { resolveAutoOutcomesPath, buildGitOutcomes, repoRoot, commitsForWindow };
