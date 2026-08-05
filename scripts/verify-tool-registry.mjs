// Verifies the tool-registry baseline (and, after M1, the compiled registry).
// Run: npm run verify:tool-registry
//
// Prints the frozen baseline counts and exits non-zero if the baseline module
// fails to load. After M1 this script is extended to compile the registry and
// report per-capability counts + validation diagnostics.
import { tsImport } from "tsx/esm/api";

const mod = await tsImport(
  "../src/lib/tool-registry/__baseline__/baseline.ts",
  import.meta.url,
);

const b = mod;
const tools = b.BASELINE_TOOLS;
const skillAgents = b.BASELINE_SKILL_AGENTS;
const usageAdapters = b.BASELINE_USAGE_ADAPTERS;
const sessionSources = b.BASELINE_SESSION_SOURCES;
const modelPrices = b.BASELINE_MODEL_PRICES;

const native = tools.filter(
  (t) => b.BASELINE_USAGE_PARSING[t.id] === "native",
).length;
const adapter = tools.filter(
  (t) => b.BASELINE_USAGE_PARSING[t.id] === "adapter",
).length;
const unsupported = tools.filter(
  (t) => b.BASELINE_USAGE_PARSING[t.id] === "unsupported",
).length;

console.log("TrustTools tool-registry baseline verify");
console.log("─────────────────────────────────────────");
console.log(`tools:                  ${tools.length}`);
console.log(`  usage native:         ${native}`);
console.log(`  usage adapter:        ${adapter}`);
console.log(`  usage unsupported:    ${unsupported}`);
console.log(`skill agents:           ${skillAgents.length}`);
console.log(`builtin usage adapters: ${usageAdapters.length}`);
console.log(`session sources:        ${sessionSources.length}`);
console.log(`model price rules:      ${modelPrices.length}`);

// Duplicate-id guard on the baseline itself.
const ids = new Set(tools.map((t) => t.id));
if (ids.size !== tools.length) {
  console.error(
    `FAIL: duplicate tool ids in baseline (${tools.length} tools, ${ids.size} unique)`,
  );
  process.exit(1);
}

console.log("\nOK: baseline intact.");
