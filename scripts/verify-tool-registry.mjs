// Verifies the tool-registry: compiles the registry (validation diagnostics
// fail the run), prints baseline + per-capability counts, and confirms the
// generated public manifest is safe.
// Run: npm run verify:tool-registry
import { tsImport } from "tsx/esm/api";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const imp = (rel) =>
  tsImport(join(root, `src/lib/tool-registry/${rel}`), import.meta.url);

const b = await imp("__baseline__/baseline.ts");
const reg = await imp("registry.ts");
const manifestMod = await imp("manifest.ts");

const {
  BASELINE_TOOLS,
  BASELINE_USAGE_PARSING,
  BASELINE_SKILL_AGENTS,
  BASELINE_USAGE_ADAPTERS,
  BASELINE_SESSION_SOURCES,
  BASELINE_MODEL_PRICES,
} = b;
const { compileToolRegistry } = reg;
const { manifestIsSafe } = manifestMod;
const { TOOL_DEFINITIONS } = await imp("tools/index.ts");

const registry = compileToolRegistry(TOOL_DEFINITIONS);

console.log("AITracker tool-registry verify");
console.log("─────────────────────────────────────────");

// Baseline counts (frozen reference).
const native = BASELINE_TOOLS.filter(
  (t) => BASELINE_USAGE_PARSING[t.id] === "native",
).length;
const adapter = BASELINE_TOOLS.filter(
  (t) => BASELINE_USAGE_PARSING[t.id] === "adapter",
).length;
const unsupported = BASELINE_TOOLS.filter(
  (t) => BASELINE_USAGE_PARSING[t.id] === "unsupported",
).length;
console.log("[baseline] tools:                " + BASELINE_TOOLS.length);
console.log(`[baseline]   usage native:       ${native}`);
console.log(`[baseline]   usage adapter:      ${adapter}`);
console.log(`[baseline]   usage unsupported:  ${unsupported}`);
console.log("[baseline] skill agents:         " + BASELINE_SKILL_AGENTS.length);
console.log(
  "[baseline] usage adapters:       " + BASELINE_USAGE_ADAPTERS.length,
);
console.log(
  "[baseline] session sources:      " + BASELINE_SESSION_SOURCES.length,
);
console.log("[baseline] model price rules:    " + BASELINE_MODEL_PRICES.length);

// Registry counts (live, must reach baseline as migrations complete).
const tools = registry.definitions;
const count = (cap, mode) =>
  tools.filter((d) => d.capabilities[cap].mode === mode).length;
console.log("[registry] compiled tools:       " + tools.length);
console.log(`[registry]   usage native:       ${count("usage", "native")}`);
console.log(`[registry]   usage adapter:      ${count("usage", "adapter")}`);
console.log(
  `[registry]   skills read-write:  ${count("skills", "read-write")}`,
);
console.log(`[registry]   sessions resume:    ${count("sessions", "resume")}`);
console.log(
  `[registry]   market install:     ${count("market", "install-target")}`,
);
console.log(
  `[registry]   pricing rules:      ${tools.reduce((n, d) => n + (d.pricing?.rules.length ?? 0), 0)}`,
);

const errors = registry.diagnostics.filter((d) => d.severity === "error");
if (errors.length > 0) {
  console.error(`\nFAIL: ${errors.length} validation error(s):`);
  for (const d of errors)
    console.error(`  ${d.toolId}: ${d.code} - ${d.message}`);
  process.exit(1);
}

if (!manifestIsSafe(registry.publicManifest)) {
  console.error("\nFAIL: public manifest leaks sensitive fields.");
  process.exit(1);
}

// Duplicate-id guard.
const ids = new Set(tools.map((t) => t.id));
if (ids.size !== tools.length) {
  console.error(
    `\nFAIL: duplicate tool ids (${tools.length} tools, ${ids.size} unique)`,
  );
  process.exit(1);
}

// Drift check: the committed generated manifest must match a fresh generation.
const committed = await imp("public-manifest.generated.ts");
if (
  JSON.stringify(committed.PUBLIC_TOOL_MANIFEST) !==
  JSON.stringify(registry.publicManifest)
) {
  console.error(
    "\nFAIL: public-manifest.generated.ts is stale. Run: npm run generate:manifest",
  );
  process.exit(1);
}

console.log("\nOK: registry valid; manifest safe + in sync; baseline intact.");
