// Verifies the tool-registry: compiles the registry from the v1.5 JSON
// definitions (validation diagnostics fail the run), prints baseline +
// per-capability counts, confirms the generated public manifest is safe, and
// checks that the committed generated modules are not stale. Also asserts the
// fixed import list contains only the 29 JSON definitions (TC-REG-006).
// Run: npm run verify:tool-registry
import { readFileSync, readdirSync } from "node:fs";
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
const { getDefaultRegistry } = reg;
const { manifestIsSafe } = manifestMod;

const registry = getDefaultRegistry();

console.log("tool-registry verify");
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

// Registry counts (live, compiled from definitions/*.tool.json).
const tools = registry.definitions;
const count = (cap, mode) =>
  tools.filter((d) => d.capabilities[cap]?.mode === mode).length;
const visible = tools.filter((d) => d.catalogVisible !== false).length;
console.log("[registry] compiled tools:       " + tools.length);
console.log("[registry]   visible:           " + visible);
console.log("[registry]   legacy hidden:     " + (tools.length - visible));
console.log(`[registry]   usage native:       ${count("usage", "native")}`);
console.log(`[registry]   usage adapter:      ${count("usage", "adapter")}`);
console.log(
  `[registry]   skills read-write:  ${count("skills", "read-write")}`,
);
console.log(`[registry]   sessions resume:    ${count("sessions", "resume")}`);
console.log(
  `[registry]   market install:     ${count("market", "install-target")}`,
);
console.log(`[registry]   context native:     ${count("context", "native")}`);
// P1-1: tools no longer declare billingMode (pricing ownership moved to
// billing routes); count tools that declare a modelObservation instead.
console.log(
  `[registry]   model observation:  ${tools.filter((d) => d.modelObservation).length}`,
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

// TC-REG-006: the fixed import list is exactly the 29 definitions dir entries;
// no legacy *.config.ts is referenced anywhere in tool-registry sources.
const manifest = JSON.parse(
  readFileSync(
    join(root, "src/lib/tool-registry/definitions/manifest.json"),
    "utf8",
  ),
);
if (manifest.tools.length !== 29) {
  console.error(
    `\nFAIL: manifest lists ${manifest.tools.length} tools, expected 29.`,
  );
  process.exit(1);
}
const defsDir = join(root, "src/lib/tool-registry/definitions");
const jsonFiles = readdirSync(defsDir)
  .filter((f) => f.endsWith(".tool.json"))
  .sort();
if (jsonFiles.length !== manifest.tools.length) {
  console.error(
    `\nFAIL: definitions dir has ${jsonFiles.length} tool JSONs, manifest lists ${manifest.tools.length}.`,
  );
  process.exit(1);
}
for (const entry of manifest.tools) {
  if (!jsonFiles.includes(entry.path)) {
    console.error(
      `\nFAIL: manifest entry ${entry.path} missing from definitions dir.`,
    );
    process.exit(1);
  }
}
// TC-REG-006 (completed): no legacy TS config anywhere in the registry.
const { execFileSync } = await import("node:child_process");
let grep = "";
try {
  grep = execFileSync(
    "rg",
    [
      "-l",
      "--no-messages",
      "config\\.ts|define-tool|tools/index",
      "src/lib/tool-registry",
    ],
    { encoding: "utf8" },
  ).trim();
} catch (e) {
  // rg exits 1 when there are no matches - which is the desired outcome.
  if (e.status !== 1) throw e;
}
if (grep) {
  console.error(`\nFAIL: legacy TS config references remain: ${grep}`);
  process.exit(1);
}

// TC-REG-005: no runtime extension entry points anywhere (docs §6.2: the
// tool-overrides.json / usage-adapters.json / custom:* layers are deleted,
// not migrated). A negative match exits 1 - treated as success. Test files
// may carry the strings as fixtures; runtime loading code must not.
for (const pattern of [
  "usage-adapters\\.json",
  "tool-overrides\\.json",
  "custom:\\*",
]) {
  let hit = "";
  try {
    hit = execFileSync(
      "rg",
      ["-l", "--no-messages", "--glob", "!*.test.ts", pattern, "src"],
      { encoding: "utf8" },
    ).trim();
  } catch (e) {
    if (e.status !== 1) throw e;
  }
  if (hit) {
    console.error(
      `\nFAIL: runtime extension reference "${pattern}" remains in: ${hit}`,
    );
    process.exit(1);
  }
}

// Drift check: committed generated modules must match a fresh generation.
const { execFileSync: run } = await import("node:child_process");
for (const script of [
  "generate-tool-imports.mjs",
  "generate-tool-manifest.mjs",
]) {
  const before = readFileSync(
    join(
      root,
      script === "generate-tool-imports.mjs"
        ? "src/lib/tool-registry/definitions.generated.ts"
        : "src/lib/tool-registry/public-manifest.generated.ts",
    ),
    "utf8",
  );
  run("node", [join(root, "scripts", script)], { encoding: "utf8" });
  const after = readFileSync(
    join(
      root,
      script === "generate-tool-imports.mjs"
        ? "src/lib/tool-registry/definitions.generated.ts"
        : "src/lib/tool-registry/public-manifest.generated.ts",
    ),
    "utf8",
  );
  if (before !== after) {
    console.error(
      `\nFAIL: generated module is stale. Run: npm run ${script === "generate-tool-imports.mjs" ? "generate:tool-imports" : "generate:manifest"}`,
    );
    process.exit(1);
  }
}

console.log(
  "\nOK: registry valid; manifest safe + in sync; fixed import list intact (29 JSON, no config.ts).",
);
