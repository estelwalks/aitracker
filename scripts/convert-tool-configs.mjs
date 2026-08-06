// One-shot semi-automatic converter: 29 tools/*.config.ts (v1.1 TS) →
// definitions/*.tool.json (v1.5 JSON). Run locally during P3-T5, deleted in
// P5-T1. Platform classification follows the prefix decision table in
// docs/develop/plan/tool-registry-json-migration-decisions.md (D4).
//
// --dry-run  : dump per-config field stats without writing anything.
// --write    : emit definitions/*.tool.json (P3-T5 will fill the mapping).
import { tsImport } from "tsx/esm/api";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dryRun = !process.argv.includes("--write");

const { TOOL_DEFINITIONS } = await tsImport(
  join(root, "src/lib/tool-registry/tools/index.ts"),
  import.meta.url,
);

/**
 * Prefix decision table (D4). Order matters: longest prefix first.
 * Returns the platform targets + path base for a flattened root/probe path.
 */
export function classifyPath(p) {
  const table = [
    ["Library/Application Support/", ["macos"], "appData"],
    ["AppData/Roaming/", ["windows10", "windows11"], "appDataRoaming"],
    [".config/", ["macos", "linux"], "configHome"],
    [".local/share/", ["macos", "linux"], "dataHome"],
  ];
  for (const [prefix, targets, base] of table) {
    if (p.startsWith(prefix)) return { targets, base, path: p };
  }
  return {
    targets: ["macos", "windows10", "windows11", "linux"],
    base: "home",
    path: p,
  };
}

function statsOf(def) {
  return {
    id: def.id,
    catalogVisible: def.catalogVisible !== false,
    roots: def.detection?.roots?.length ?? 0,
    executable: def.detection?.executable?.length ?? 0,
    usageMode: def.capabilities?.usage?.mode,
    usageReader: def.capabilities?.usage?.reader ?? null,
    usagePaths: def.capabilities?.usage?.paths?.length ?? 0,
    hasMapping: def.capabilities?.usage?.mapping != null,
    hasQuery: def.capabilities?.usage?.query != null,
    skillsRoots: def.storage?.skills?.roots?.length ?? 0,
    skillsEnvHome: def.storage?.skills?.envHome ?? null,
    skillsMarkers: def.storage?.skills?.markers ?? null,
    sessionsMode: def.capabilities?.sessions?.mode,
    hasPricing: def.pricing != null,
    platformsCandidate:
      def.detection?.roots
        ?.map((p) => classifyPath(p).targets.join("+"))
        .join(" | ") ?? "",
  };
}

if (dryRun) {
  for (const def of TOOL_DEFINITIONS) {
    console.log(JSON.stringify(statsOf(def), null, 2));
  }
  console.log(
    `\nTotal: ${TOOL_DEFINITIONS.length} definitions (dry-run, no files written).`,
  );
  process.exit(0);
}

// --write is implemented in P3-T5: convert each def via classifyPath into a
// RawToolDefinition-shaped JSON object and write definitions/<id>.tool.json.
const outDir = join(root, "src/lib/tool-registry/definitions");
await mkdir(outDir, { recursive: true });
console.error("--write not implemented yet (P3-T5 fills the mapping).");
process.exit(1);
