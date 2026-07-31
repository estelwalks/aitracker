// Skill usage analytics — the one angle a token tracker uniquely owns that a
// dedicated skill manager structurally cannot: "which installed skills do I
// actually invoke, and what do they cost?"
//
// Design constraints (deliberate):
//   * READ-ONLY and fully DECOUPLED from the token parser. We do NOT touch
//     rollout.js / queue.jsonl — editing the incremental parser is this repo's
//     documented #1 footgun (it silently shifts token totals). This scanner
//     reads ~/.claude transcripts on demand and never writes to the queue.
//   * Privacy: only the skill NAME + token counts leave a transcript. Never
//     prompts, args, file contents, or message bodies.
//   * Claude-only v1: the {type:"tool_use",name:"Skill",input:{skill}} signal is
//     a Claude-transcript structure. Other providers have different log shapes;
//     generalizing is explicitly out of scope.
//   * De-dup invocations by tool_use `id` so a turn duplicated across the main
//     session + subagent files is counted once.
//   * A turn's usage is split evenly across the Skill blocks it invoked, so the
//     sum of per-skill cost == the cost of the invoking turns (no double count).
//     This is an approximate "cost of invoking turns", surfaced as such.

const fs = require("node:fs");
const fssync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");

const USAGE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SKILL_TOKEN_KEYS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
];

function claudeProjectsDir(home) {
  return path.join(home || os.homedir(), ".claude", "projects");
}

function dataDir(home) {
  return path.join(home || os.homedir(), ".tokentracker", "skills");
}

function usageCachePath(home) {
  return path.join(dataDir(home), "usage-cache.json");
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// Same column mapping as the Claude parser's normalizeClaudeUsage, kept local so
// this module never imports the heavy rollout parser.
function normalizeUsage(usage) {
  return {
    input_tokens: toInt(usage?.input_tokens),
    output_tokens: toInt(usage?.output_tokens),
    cached_input_tokens: toInt(usage?.cache_read_input_tokens),
    cache_creation_input_tokens: toInt(usage?.cache_creation_input_tokens),
    reasoning_output_tokens: 0,
  };
}

function emptyTokens() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
  };
}

function addScaledTokens(target, delta, scale) {
  for (const key of SKILL_TOKEN_KEYS) {
    target[key] += (delta[key] || 0) * scale;
  }
}

async function listTranscriptFiles(rootDir) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (_e) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        let stat;
        try {
          stat = await fs.promises.stat(full);
        } catch (_e) {
          continue;
        }
        out.push({ path: full, size: stat.size, mtimeMs: Math.floor(stat.mtimeMs) });
      }
    }
  }
  await walk(rootDir);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function fingerprintFiles(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) hash.update(`${file.path}:${file.size}:${file.mtimeMs}\n`);
  return `${files.length}:${hash.digest("hex")}`;
}

function ensureSkill(map, name) {
  let entry = map.get(name);
  if (!entry) {
    entry = {
      skill: name,
      invocations: 0,
      lastUsedAt: null,
      tokens: emptyTokens(),
      models: {}, // model -> token columns (for per-model pricing downstream)
    };
    map.set(name, entry);
  }
  return entry;
}

// Scan a single transcript for Skill tool_use blocks. Mutates `skillMap` and the
// shared `seenBlockIds` set (for cross-file de-dup). String pre-filter keeps this
// cheap — most lines never get JSON.parsed.
async function scanFile(filePath, skillMap, seenBlockIds) {
  const stream = fssync.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line || line.indexOf('"name":"Skill"') === -1) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (_e) {
        continue;
      }
      const message = obj?.message;
      const content = message?.content;
      if (!Array.isArray(content)) continue;

      // Collect this turn's fresh (not-yet-seen) Skill invocations first so we
      // can split the turn's usage evenly across them.
      const blocks = [];
      for (const block of content) {
        if (!block || block.type !== "tool_use" || block.name !== "Skill") continue;
        const id = typeof block.id === "string" ? block.id : null;
        if (id && seenBlockIds.has(id)) continue;
        const skillName = String(block?.input?.skill || "").trim();
        if (!skillName) continue;
        if (id) seenBlockIds.add(id);
        blocks.push({ id, skillName });
      }
      if (!blocks.length) continue;

      const ts = typeof obj?.timestamp === "string" ? obj.timestamp : null;
      const model = String(message?.model || "").trim() || "unknown";
      const turnTokens = normalizeUsage(message?.usage);
      const share = 1 / blocks.length;

      for (const block of blocks) {
        const entry = ensureSkill(skillMap, block.skillName);
        entry.invocations += 1;
        if (ts && (!entry.lastUsedAt || ts > entry.lastUsedAt)) entry.lastUsedAt = ts;
        addScaledTokens(entry.tokens, turnTokens, share);
        if (!entry.models[model]) entry.models[model] = emptyTokens();
        addScaledTokens(entry.models[model], turnTokens, share);
      }
    }
  } finally {
    rl.close();
    stream.close?.();
  }
}

function roundTokens(tokens) {
  const out = {};
  for (const key of SKILL_TOKEN_KEYS) out[key] = Math.round(tokens[key] || 0);
  out.total_tokens =
    out.input_tokens +
    out.output_tokens +
    out.cached_input_tokens +
    out.cache_creation_input_tokens +
    out.reasoning_output_tokens;
  return out;
}

function serialize(skillMap, meta) {
  const skills = Array.from(skillMap.values())
    .map((entry) => ({
      skill: entry.skill,
      invocations: entry.invocations,
      lastUsedAt: entry.lastUsedAt,
      tokens: roundTokens(entry.tokens),
      models: Object.fromEntries(
        Object.entries(entry.models).map(([model, tokens]) => [model, roundTokens(tokens)]),
      ),
    }))
    .sort((a, b) => b.invocations - a.invocations);
  return { ...meta, skills };
}

// Public entry: scan (or return cached) per-skill invocation + token aggregates.
// `home` override is for tests/sandboxing. Returns raw aggregates keyed by the
// skill name exactly as logged — the caller joins against installed skills and
// applies pricing.
async function scanSkillUsage({ home, force = false } = {}) {
  const root = claudeProjectsDir(home);
  const files = await listTranscriptFiles(root);
  const fingerprint = fingerprintFiles(files);

  if (!force) {
    let cached = null;
    try {
      cached = JSON.parse(fssync.readFileSync(usageCachePath(home), "utf8"));
    } catch (_e) {
      cached = null;
    }
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      Number.isFinite(cached.generatedAt) &&
      Date.now() - cached.generatedAt < USAGE_CACHE_TTL_MS &&
      Array.isArray(cached.skills)
    ) {
      return { ...cached, cached: true };
    }
  }

  const skillMap = new Map();
  const seenBlockIds = new Set();
  for (const file of files) {
    await scanFile(file.path, skillMap, seenBlockIds);
  }

  const result = serialize(skillMap, {
    fingerprint,
    generatedAt: Date.now(),
    scannedFiles: files.length,
    totalInvocations: Array.from(skillMap.values()).reduce((sum, s) => sum + s.invocations, 0),
  });

  try {
    fssync.mkdirSync(dataDir(home), { recursive: true });
    fssync.writeFileSync(usageCachePath(home), `${JSON.stringify(result)}\n`, { mode: 0o600 });
  } catch (_e) {
    // best-effort cache write
  }

  return { ...result, cached: false };
}

module.exports = {
  scanSkillUsage,
  // exported for tests
  normalizeUsage,
  fingerprintFiles,
};
