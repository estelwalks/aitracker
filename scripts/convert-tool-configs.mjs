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
 * Prefix decision table (D4). Order matters: longest prefix first. Returns the
 * platform targets + path base for a flattened HOME-relative root/probe path,
 * stripping the base prefix so `path` is base-relative (the loader projects
 * it back to the identical flattened string - parity).
 */
export function classifyPath(p) {
  const table = [
    ["Library/Application Support/", ["macos"], "appData"],
    ["AppData/Roaming/", ["windows10", "windows11"], "appDataRoaming"],
    [".config/", ["macos", "linux"], "configHome"],
    [".local/share/", ["macos", "linux"], "dataHome"],
  ];
  for (const [prefix, targets, base] of table) {
    if (p.startsWith(prefix)) {
      return { targets, base, path: p.slice(prefix.length) };
    }
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

// --write: convert each def into a RawToolDefinition-shaped JSON object and
// write definitions/<id>.tool.json. Defaults/omissions follow the decisions:
//  - mapping equal to the generic defaults is omitted (loader fills it back)
//  - aipy keeps its custom mapping + query + size cap
//  - claude-code/codex get a native context capability (D10)
//  - tools with a usage plan get api-metered + unpriced-v1 (D11)
//  - claude-code/codex/grok get a shared executable declaration (D12)
const { readFileSync } = await import("node:fs");
const COMMON_MAPPING = JSON.parse(
  readFileSync(
    join(
      root,
      "src/lib/tool-registry/definitions/_shared/generic-reader-defaults.json",
    ),
    "utf8",
  ),
).defaultMapping;

const CONTEXT_DIMENSIONS = [
  "tools",
  "skills",
  "commands",
  "mcp",
  "toolOutputs",
];
const CONTEXT_READERS = {
  "claude-code": "claude-context-v1",
  codex: "codex-context-v1",
};
const EXECUTABLES = {
  "claude-code": { shared: ["claude"] },
  codex: { shared: ["codex"] },
  grok: { shared: ["grok"] },
};

function usageOf(def) {
  const u = def.capabilities.usage;
  if (u.mode === "unsupported") return { mode: "unsupported" };
  const paths = u.paths.map((p) => ({
    ...classifyPath(p.root),
    glob: p.glob,
    format: p.format,
  }));
  const mapping =
    u.mapping && JSON.stringify(u.mapping) !== JSON.stringify(COMMON_MAPPING)
      ? u.mapping
      : undefined;
  return {
    mode: u.mode,
    reader: u.reader,
    paths,
    ...(mapping ? { mapping } : {}),
    ...(u.maxFileSizeBytes !== undefined
      ? { maxFileSizeBytes: u.maxFileSizeBytes }
      : {}),
    ...(u.query ? { query: u.query } : {}),
  };
}

function pricingOf(def) {
  const billable =
    def.capabilities.usage.mode !== "unsupported" &&
    def.capabilities.usage.paths?.length;
  return billable
    ? {
        billingMode: "api-metered",
        fallbackProfileRef: "unpriced-v1",
        rulePackRefs: [],
      }
    : {
        billingMode: "unsupported",
        fallbackProfileRef: "unpriced-v1",
        rulePackRefs: [],
      };
}

const outDir = join(root, "src/lib/tool-registry/definitions");
await mkdir(outDir, { recursive: true });
for (const def of TOOL_DEFINITIONS) {
  const raw = {
    $schema: "../tool-definition.schema.json",
    configVersion: 1,
    id: def.id,
    ...(def.catalogVisible !== undefined
      ? { catalogVisible: def.catalogVisible }
      : {}),
    display: def.display,
    platforms: { macos: "supported", windows: "supported", linux: "planned" },
    detection: {
      locations: def.detection.roots.map((r) => classifyPath(r)),
      ...(EXECUTABLES[def.id] ? { executable: EXECUTABLES[def.id] } : {}),
    },
    ...(def.storage
      ? {
          storage: {
            ...(def.storage.dataRoots?.length
              ? { dataRoots: def.storage.dataRoots }
              : {}),
            ...(def.storage.skills
              ? {
                  skills: {
                    rootSpecs: def.storage.skills.roots.map((r) => ({
                      base: "home",
                      path: r,
                    })),
                    ...(def.storage.skills.envHome
                      ? { envHome: def.storage.skills.envHome }
                      : {}),
                    ...(def.storage.skills.markers
                      ? { markers: def.storage.skills.markers }
                      : {}),
                    ...(def.storage.skills.maxDepth !== undefined
                      ? { maxDepth: def.storage.skills.maxDepth }
                      : {}),
                  },
                }
              : {}),
            ...(def.storage.agents ? { agents: def.storage.agents } : {}),
          },
        }
      : {}),
    capabilities: {
      usage: usageOf(def),
      ...(CONTEXT_READERS[def.id]
        ? {
            context: {
              mode: "native",
              reader: CONTEXT_READERS[def.id],
              dimensions: CONTEXT_DIMENSIONS,
            },
          }
        : {}),
      skills: def.capabilities.skills.mode,
      agents: def.capabilities.agents.mode,
      sessions:
        def.capabilities.sessions.mode === "unsupported"
          ? { mode: "unsupported" }
          : def.capabilities.sessions,
      market: def.capabilities.market.mode,
      security: def.capabilities.security.mode,
    },
    pricing: pricingOf(def),
  };
  const outPath = join(outDir, `${def.id}.tool.json`);
  await writeFile(outPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}
console.log(`Total: ${TOOL_DEFINITIONS.length} definitions written.`);
