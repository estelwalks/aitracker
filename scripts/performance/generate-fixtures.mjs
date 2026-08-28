// Generates deterministic, sanitized performance fixtures under
// `tests/fixtures/performance/` (T0-06). Fixtures are pure synthetic data —
// no real paths, prompts, commands, API keys or conversation content — so the
// same bytes can be reproduced on any machine. Small fixtures are committed
// for fast checks; the 10x fixture is generated on demand to keep Git lean.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "tests/fixtures/performance");

const SOURCES = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "grok",
  "copilot",
  "cline",
  "roo-code",
  "kimi-code",
  "deepseek-harness",
];
const MODELS = [
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-3-7-sonnet",
  "gpt-5.2-codex",
  "gpt-5-codex",
  "gemini-3-pro",
  "grok-code-3",
  "kimi-k2.5",
  "deepseek-v3.1",
  "deepseek-r1",
];

export const FIXTURE_SIZES = {
  empty: 0,
  small: 120,
  "current-scale": 6_227,
  "10x": 62_270,
};

/** Deterministic PRNG so regeneration produces byte-identical files. */
function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function createEvent(index, rng, baseDate) {
  const inputTokens = 100 + Math.floor(rng() * 1_000);
  const cachedInputTokens = Math.floor(rng() * 200);
  const cacheCreationInputTokens = Math.floor(rng() * 50);
  const outputTokens = 50 + Math.floor(rng() * 300);
  const reasoningOutputTokens = Math.floor(rng() * 80);
  const totalTokens =
    inputTokens +
    cachedInputTokens +
    cacheCreationInputTokens +
    outputTokens +
    reasoningOutputTokens;
  const minutesAgo = Math.floor(rng() * 30 * 24 * 60);
  return {
    source: SOURCES[index % SOURCES.length],
    timestamp: new Date(baseDate.getTime() - minutesAgo * 60_000).toISOString(),
    model: MODELS[index % MODELS.length],
    project: `project-${String(index % 25).padStart(2, "0")}`,
    sessionId: index % 17 === 0 ? undefined : `session-${index % 2_000}`,
    inputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

function generate(size, seed, baseDate) {
  const events = [];
  for (let index = 0; index < size; index += 1)
    events.push(createEvent(index, seed, baseDate));
  return events;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const baseDate = new Date("2026-07-01T00:00:00.000Z");
  const manifest = {
    manifestVersion: 1,
    generator: "scripts/performance/generate-fixtures.mjs",
    generatedAt: "FIXED",
    sizes: {},
    files: [],
    privacy: {
      declaration:
        "Synthetic data only: no real paths, prompts, commands, API keys or conversation content.",
      forbiddenTokens: [
        "c:\\",
        "/users/",
        "home/",
        ".claude",
        ".codex",
        "api_key",
        "sk-",
        "prompt",
        "bearer",
      ],
    },
  };
  for (const [name, count] of Object.entries(FIXTURE_SIZES)) {
    const seed = createRng(0x5eed ^ count);
    const events = generate(count, seed, baseDate);
    const payload = JSON.stringify(events);
    const hash = createHash("sha256").update(payload).digest("hex");
    const fileName = `fixture-${name}.events.json`;
    await writeFile(join(outDir, fileName), payload, "utf8");
    manifest.sizes[name] = count;
    manifest.files.push({
      file: fileName,
      events: count,
      bytes: Buffer.byteLength(payload),
      sha256: hash,
    });
  }
  await writeFile(
    join(outDir, "manifest.v1.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `wrote ${manifest.files.length} fixtures to ${outDir} (${Object.values(FIXTURE_SIZES).join("/")} events)`,
  );
}

if (
  process.argv[1] &&
  join(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
