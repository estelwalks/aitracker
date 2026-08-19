// Verifies read-model DTO budgets and privacy contracts (P1-T1-08).
// Usage: node --import tsx scripts/verify-read-model-budgets.mts
// - Loads the fixed performance fixtures and builds the compact dashboard
//   summary for each scale, asserting:
//     * serialized DTO bytes stay within the budget (Dashboard ≤ 250 KB)
//     * no forbidden fields (commands, paths, prompts, secrets, sessions)
//     * the summary never contains raw events
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(root, "tests/fixtures/performance");
const budgetsPath = join(root, "tests/performance/budgets.v1.json");
const budgets = JSON.parse(await readFile(budgetsPath, "utf8"));
const dashboardBudget = budgets.dtoBytes.dashboardFirstScreen;

const { createDashboardSummaryProjector } = await tsImport(
  pathToFileURL(
    join(root, "src/modules/dashboard/application/summary-projector.ts"),
  ).href,
  import.meta.url,
);
const { createDashboardV2SnapshotFromEvents } = await tsImport(
  pathToFileURL(join(root, "src/modules/dashboard/test-snapshot-builder.ts"))
    .href,
  import.meta.url,
).catch(() => null);

if (!createDashboardV2SnapshotFromEvents) {
  console.error(
    "verify-read-model-budgets: test-snapshot-builder not found; cannot build snapshots",
  );
  process.exit(1);
}

const FORBIDDEN_KEYS = [
  "command",
  "prompt",
  "transcript",
  "sessionBody",
  "messages",
  "rawContent",
  "content",
  "response",
  "apiKey",
  "accessToken",
  "authorization",
  "password",
  "secret",
  "path",
  "root",
  "home",
];

function walkForbidden(value, path = "$", hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      walkForbidden(item, `${path}[${index}]`, hits),
    );
    return hits;
  }
  if (value == null || typeof value !== "object") return hits;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.includes(key.toLowerCase())) hits.push(`${path}.${key}`);
    walkForbidden(child, `${path}.${key}`, hits);
  }
  return hits;
}

let failures = 0;

async function run() {
  const files = (await readdir(fixtureDir)).filter((name) =>
    name.endsWith(".events.json"),
  );
  if (files.length === 0) {
    console.error("no fixtures; run npm run perf:fixtures first");
    process.exit(1);
  }
  for (const file of files) {
    const events = JSON.parse(await readFile(join(fixtureDir, file), "utf8"));
    const snapshot = createDashboardV2SnapshotFromEvents(events);
    const projector = createDashboardSummaryProjector();
    const summary = projector.build({
      snapshot,
      locale: "zh-CN",
    });
    const bytes = summary.meta.dtoBytes;
    const forbidden = walkForbidden(summary);
    const hasRawEvents =
      Array.isArray(summary) ||
      Object.prototype.hasOwnProperty.call(summary, "events") ||
      Object.prototype.hasOwnProperty.call(summary, "details");
    const ok =
      bytes <= dashboardBudget && forbidden.length === 0 && !hasRawEvents;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${file}: dtoBytes=${bytes} budget=${dashboardBudget} forbidden=${forbidden.length} rawEvents=${hasRawEvents}`,
    );
    if (!ok) failures += 1;
  }
  if (failures > 0) {
    console.error(`verify-read-model-budgets: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("verify-read-model-budgets: OK");
}

await run();
