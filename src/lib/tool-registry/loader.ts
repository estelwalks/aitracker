/**
 * Loader: compiles validated v1.5 raw definitions (the JSON world,
 * `definitions/*.tool.json`) into the runtime `ToolDefinition` shape (the
 * v1.1 superset). It projects platform-aware locations/rootSpecs into the
 * flattened `roots`/`root` fields legacy consumers still read (Phase 4
 * switches them to `resolvePlatformPlan`/`getSkillPlan`), and applies
 * shared-policy defaults (markers, maxDepth, generic mapping, size cap).
 *
 * `loadBuiltinDefinitions()` reads the build-time generated module
 * (`definitions.generated.ts`) - runtime never scans directories or reads
 * JSON (docs §4/§5).
 */
import type {
  DetectionLocation,
  PathBase,
  SkillRootSpec,
  ToolDefinition,
  UsageCapability,
  UsageFieldMapping,
  UsagePathSpec,
} from "./contracts.ts";
import type { RawToolDefinition, SharedPolicyPacks } from "./schema.ts";
import { PRICING_PACKS } from "../pricing/pricing-definitions.generated.ts";

/**
 * The JSON-world `base` narrows to `string` in TypeScript (enum + env regex);
 * the schema already runtime-validates the value, so the cast is safe.
 */
function toBase(base: string): PathBase {
  return base as PathBase;
}

function toDetectionLocation(
  loc: RawToolDefinition["detection"]["locations"][number],
): DetectionLocation {
  return {
    targets: loc.targets,
    base: toBase(loc.base),
    path: loc.path,
    ...(loc.glob ? { glob: loc.glob } : {}),
  };
}

type RawSkillRootSpec = NonNullable<
  NonNullable<NonNullable<RawToolDefinition["storage"]>["skills"]>["rootSpecs"]
>[number];

function toSkillRootSpec(root: RawSkillRootSpec): SkillRootSpec {
  return { base: toBase(root.base), path: root.path };
}

/** Base -> flattened HOME-relative prefix (docs §6.1 + D4 reverse mapping). */
const BASE_PREFIX: Readonly<Record<string, string>> = {
  home: "",
  userProfile: "AppData/",
  appData: "Library/Application Support/",
  appDataRoaming: "AppData/Roaming/",
  configHome: ".config/",
  dataHome: ".local/share/",
};

/**
 * Project a (base, path) pair to the flattened HOME-relative form legacy
 * consumers read. `env:NAME` bases cannot be projected (they resolve at
 * runtime) and return null.
 */
export function projectBase(base: string, path: string): string | null {
  const prefix = BASE_PREFIX[base];
  if (prefix === undefined) return null;
  return prefix + path;
}

/** Project a v1.5 location to its flattened root. */
export function projectLocation(loc: DetectionLocation): string | null {
  return projectBase(loc.base, loc.path);
}

/** Dedupe while preserving order. */
function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function compileUsage(
  usage: RawToolDefinition["capabilities"]["usage"],
  packs: SharedPolicyPacks,
): UsageCapability {
  if (usage.mode === "unsupported") return { mode: "unsupported" };
  const paths: UsagePathSpec[] = (usage.paths ?? []).map((p) => ({
    root: projectBase(p.base, p.path) ?? p.path,
    glob: p.glob,
    format: p.format,
  }));
  const mapping: UsageFieldMapping =
    usage.mapping ?? packs.genericReaderDefaults.defaultMapping;
  return {
    mode: usage.mode,
    reader: usage.reader,
    paths,
    mapping,
    maxFileSizeBytes:
      usage.maxFileSizeBytes ??
      packs.genericReaderDefaults.defaultMaxFileSizeBytes,
    ...(usage.query ? { query: usage.query } : {}),
  };
}

/**
 * Compile one raw v1.5 definition into the runtime (superset) shape, applying
 * shared-policy defaults.
 */
export function compileRawTool(
  raw: RawToolDefinition,
  packs: SharedPolicyPacks,
): ToolDefinition {
  const locations = raw.detection.locations.map(toDetectionLocation);
  const detectionRoots = locations
    .map(projectLocation)
    .filter((r): r is string => r !== null);
  const skillsRoots = (raw.storage?.skills?.rootSpecs ?? [])
    .map((r) => projectBase(r.base, r.path))
    .filter((r): r is string => r !== null);
  const sharedExecutable = raw.detection.executable?.shared ?? [];

  const def: ToolDefinition = {
    id: raw.id,
    configVersion: 1,
    ...(raw.catalogVisible !== undefined
      ? { catalogVisible: raw.catalogVisible }
      : {}),
    display: raw.display,
    platforms: raw.platforms,
    detection: {
      roots: dedupe(detectionRoots),
      ...(sharedExecutable.length > 0
        ? { executable: [...sharedExecutable] }
        : {}),
      locations,
      ...(raw.detection.executable
        ? { executableSpec: raw.detection.executable }
        : {}),
    },
    ...(raw.storage
      ? {
          storage: {
            ...(raw.storage.dataRoots?.length
              ? {
                  dataRoots: raw.storage.dataRoots.map((r) => ({
                    base: toBase(r.base),
                    path: r.path,
                  })),
                }
              : {}),
            ...(raw.storage.skills
              ? {
                  skills: {
                    roots: dedupe(skillsRoots),
                    ...(raw.storage.skills.envHome
                      ? { envHome: raw.storage.skills.envHome }
                      : {}),
                    markers: raw.storage.skills.markers ?? [
                      ...packs.skillMarketPolicy.defaultMarkers,
                    ],
                    maxDepth:
                      raw.storage.skills.maxDepth ??
                      packs.skillMarketPolicy.defaultMaxDepth,
                    ...(raw.storage.skills.rootSpecs
                      ? {
                          rootSpecs:
                            raw.storage.skills.rootSpecs.map(toSkillRootSpec),
                        }
                      : {}),
                  },
                }
              : {}),
            ...(raw.storage.agents
              ? {
                  agents: {
                    mode: raw.storage.agents.mode,
                    roots: raw.storage.agents.roots ?? [],
                  },
                }
              : {}),
          },
        }
      : {}),
    capabilities: {
      usage: compileUsage(raw.capabilities.usage, packs),
      skills: { mode: raw.capabilities.skills },
      agents: { mode: raw.capabilities.agents },
      sessions:
        raw.capabilities.sessions.mode === "resume"
          ? {
              mode: "resume",
              reader: raw.capabilities.sessions.reader,
              command: raw.capabilities.sessions.command ?? [],
            }
          : { mode: "unsupported" },
      market: { mode: raw.capabilities.market },
      security: { mode: raw.capabilities.security },
      ...(raw.capabilities.context
        ? { context: raw.capabilities.context }
        : {}),
    },
    ...(raw.pricing
      ? {
          pricing: {
            billingMode: raw.pricing.billingMode,
            fallbackProfileRef: raw.pricing.fallbackProfileRef,
            rulePackRefs: [...raw.pricing.rulePackRefs],
            ...(raw.pricing.provider ? { provider: raw.pricing.provider } : {}),
          },
        }
      : {}),
  };
  return def;
}

/**
 * Compile a batch of raw definitions in manifest order.
 */
export function compileRawTools(
  raws: readonly RawToolDefinition[],
  packs: SharedPolicyPacks,
): ToolDefinition[] {
  return raws.map((raw) => compileRawTool(raw, packs));
}

/**
 * Verify every `pricing.rulePackRefs` entry resolves to a built-in pack id
 * (docs §8.2; pricing packs live in src/lib/pricing/rules/ - approved diff D3).
 * Returns per-tool error messages (empty when all refs resolve).
 */
export function validateRulePackRefs(
  raws: readonly RawToolDefinition[],
): string[] {
  const known = new Set(PRICING_PACKS.map((p) => p.packId));
  const errors: string[] = [];
  for (const raw of raws) {
    for (const ref of raw.pricing?.rulePackRefs ?? []) {
      if (!known.has(ref)) {
        errors.push(`${raw.id}: unknown rule pack "${ref}"`);
      }
    }
  }
  return errors;
}
