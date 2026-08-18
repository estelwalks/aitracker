// Unified performance benchmark entry (T0-06/T0-07). Loads the deterministic
// sanitized fixtures from tests/fixtures/performance, measures the core
// read-model pipeline (filter -> aggregate -> projection -> serialize) and
// writes a JSON report (git SHA, environment, fixture hash, P50/P95/P99,
// bytes) to docs/develop/test/baselines/. Non-blocking by default: it never
// fails the build; budgets are evaluated by gate scripts.
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = join(root, "tests/fixtures/performance");
const baselineDir = join(root, "docs/develop/test/baselines");
const RUNS = Number(process.env.PERF_RUNS ?? "5");

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

async function loadFixture(manifest, name) {
  const entry = manifest.files.find(
    (file) => file.file === `fixture-${name}.events.json`,
  );
  if (!entry) throw new Error(`missing fixture: ${name}`);
  const text = await readFile(join(fixtureDir, entry.file), "utf8");
  return { events: JSON.parse(text), hash: entry.sha256, bytes: entry.bytes };
}

async function main() {
  const manifest = JSON.parse(
    await readFile(join(fixtureDir, "manifest.v1.json"), "utf8"),
  );
  const { buildLocalUsageSnapshot } = await tsImport(
    pathToFileURL(join(root, "src/lib/local-usage/aggregate.ts")).href,
    import.meta.url,
  );
  const { filterUsageEvents } = await tsImport(
    pathToFileURL(join(root, "src/lib/local-usage/presentation.ts")).href,
    import.meta.url,
  );
  const { aggregateEventsByTime } = await tsImport(
    pathToFileURL(join(root, "src/lib/local-usage/presentation.ts")).href,
    import.meta.url,
  );

  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    gitSha: gitSha(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    fixtures: {},
  };

  for (const name of ["empty", "small", "current-scale", "10x"]) {
    const { events, hash, bytes } = await loadFixture(manifest, name);
    const now = new Date("2026-07-01T00:00:00.000Z");
    const durations = [];
    for (let run = 0; run < RUNS; run += 1) {
      const startedAt = performance.now();
      const filtered = filterUsageEvents(events, "all", null, null, now);
      const snapshot = buildLocalUsageSnapshot(filtered, [], now);
      const daily = aggregateEventsByTime(filtered, "day");
      durations.push(performance.now() - startedAt);
      if (run === 0) {
        // Serialize the closest page DTO shape once for the byte budget.
        const dto = {
          generatedAt: snapshot.generatedAt,
          totals: snapshot.totals,
          daily: daily.length,
          events: filtered.length,
        };
        report.fixtures[name] = {
          events: events.length,
          fixtureBytes: bytes,
          fixtureHash: hash,
          dtoBytes: Buffer.byteLength(JSON.stringify(dto)),
          requestCount: 1,
        };
      }
    }
    const sorted = [...durations].sort((a, b) => a - b);
    report.fixtures[name].durationMs = {
      p50: Number(pct(sorted, 50).toFixed(2)),
      p95: Number(pct(sorted, 95).toFixed(2)),
      p99: Number(pct(sorted, 99).toFixed(2)),
      runs: RUNS,
    };
  }

  await mkdir(baselineDir, { recursive: true });
  const outPath = join(
    baselineDir,
    `performance-baseline-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`baseline written to ${outPath}`);
}

await main();
