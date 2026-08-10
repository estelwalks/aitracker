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
import type {
  PlatformProfiles,
  RawToolDefinition,
  SharedPolicyPacks,
} from "./schema.ts";
import {
  RAW_TOOL_DEFINITIONS,
  SHARED_POLICY_PACKS,
  TOOL_REGISTRY_VERSION,
} from "./definitions.generated.ts";

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

/**
 * Env vars that redirect the XDG bases at resolution time (F5-T1). The
 * platform profile declares the *default* directories in `xdgFallback`; the
 * consumer layer can override them via these vars.
 */
export const XDG_ENV_VARS: Readonly<Record<string, string>> = {
  configHome: "XDG_CONFIG_HOME",
  dataHome: "XDG_DATA_HOME",
};

/** Conventional HOME-relative prefixes for the non-XDG bases (docs §6.1 + D4 reverse mapping). */
const CONVENTIONAL_PREFIX: Readonly<Record<string, string>> = {
  home: "",
  userProfile: "AppData/",
  appData: "Library/Application Support/",
  appDataRoaming: "AppData/Roaming/",
};

/** "~/.config" -> ".config" (the flattened HOME-relative form). */
function homeRelative(dir: string): string {
  if (dir === "~") return "";
  if (dir.startsWith("~/")) return dir.slice(2);
  return dir;
}

/**
 * Build the base -> flattened HOME-relative prefix table from the platform
 * profile (F5-T1). Every base declared in `basePlatforms` is projected via its
 * conventional prefix, except `configHome`/`dataHome`, which take their default
 * directory from `xdgFallback`. Bases the profile does not declare (e.g.
 * `env:NAME`) are absent, so `projectBase` returns null for them - the profile
 * is the authoritative source for what can be flattened.
 */
export function buildBasePrefixes(
  profiles: PlatformProfiles,
): ReadonlyMap<string, string> {
  const prefixes = new Map<string, string>();
  for (const base of Object.keys(profiles.basePlatforms)) {
    const conventional = CONVENTIONAL_PREFIX[base];
    if (conventional !== undefined) {
      prefixes.set(base, conventional);
      continue;
    }
    const fallback = profiles.xdgFallback[base];
    if (fallback !== undefined) {
      prefixes.set(base, `${homeRelative(fallback)}/`);
    }
  }
  return prefixes;
}

/**
 * Base -> flattened HOME-relative prefix (docs §6.1 + D4 reverse mapping),
 * derived from the authoritative `platform-profiles.json` (via the generated
 * shared packs) instead of a hardcoded table.
 */
const BASE_PREFIX: ReadonlyMap<string, string> = buildBasePrefixes(
  SHARED_POLICY_PACKS.platformProfiles,
);

/**
 * Project a (base, path) pair to the flattened HOME-relative form legacy
 * consumers read. `env:NAME` bases cannot be projected (they resolve at
 * runtime) and return null.
 */
export function projectBase(base: string, path: string): string | null {
  const prefix = BASE_PREFIX.get(base);
  if (prefix === undefined) return null;
  return prefix + path;
}

export interface ProjectedPath {
  /**
   * Final path. When `homeRelative` is true it is a HOME-relative suffix
   * (`join(home, path)`); otherwise it is self-contained (use as-is).
   */
  path: string;
  homeRelative: boolean;
}

function joinPath(dir: string, path: string): string {
  return `${dir.replace(/\/+$/, "")}/${path}`;
}

/**
 * Env-aware projection (F5-T1 XDG support): `configHome`/`dataHome` honor
 * `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (absolute when set; `xdgFallback` when
 * unset), and `env:NAME` bases resolve to `$NAME/path` when the variable is
 * set. Every other base projects exactly like `projectBase` (HOME-relative).
 */
export function projectBaseWithEnv(
  base: string,
  path: string,
  env: Readonly<Record<string, string | undefined>>,
): ProjectedPath | null {
  if (base.startsWith("env:")) {
    const value = env[base.slice(4)];
    if (!value) return null;
    return { path: joinPath(value, path), homeRelative: false };
  }
  const xdgVar = XDG_ENV_VARS[base];
  if (xdgVar !== undefined) {
    const value = env[xdgVar];
    if (value) return { path: joinPath(value, path), homeRelative: false };
  }
  const projected = projectBase(base, path);
  if (projected === null) return null;
  return { path: projected, homeRelative: true };
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
    targets: p.targets,
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
    ...(raw.modelObservation
      ? {
          // P1-1: the runtime `modelObservation` projection (billing evidence
          // extraction, never rates/modes; audit P1-1 renamed the legacy
          // `pricing` field). Tools never hold rates or a billing mode.
          modelObservation: {
            modelField: raw.modelObservation.modelField ?? "model",
            normalizeProfile:
              raw.modelObservation.normalizeProfile ?? "generic-normalize-v1",
            ...(raw.modelObservation.evidence
              ? { evidence: raw.modelObservation.evidence }
              : {}),
            ...(raw.modelObservation.tokenSemantics
              ? { tokenSemantics: raw.modelObservation.tokenSemantics }
              : {}),
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

/** Normalization profile ids known to the pricing module (normalize.ts). */
export const KNOWN_NORMALIZE_PROFILES: readonly string[] = [
  "generic-normalize-v1",
];

/**
 * Verify every `modelObservation.normalizeProfile` resolves to a known
 * normalization profile (P1-1; replaced the legacy rule-pack ref check, since
 * tools no longer reference price packs). Absent profile defaults to
 * `generic-normalize-v1`. Returns per-tool error messages (empty when all
 * refs resolve).
 */
export function validateModelObservationProfiles(
  raws: readonly RawToolDefinition[],
): string[] {
  const errors: string[] = [];
  for (const raw of raws) {
    const profile =
      raw.modelObservation?.normalizeProfile ?? "generic-normalize-v1";
    if (!KNOWN_NORMALIZE_PROFILES.includes(profile)) {
      errors.push(
        `${raw.id}: unknown normalize profile "${profile}" (known: ${KNOWN_NORMALIZE_PROFILES.join(", ")})`,
      );
    }
  }
  return errors;
}

export interface BuiltinDefinitions {
  definitions: readonly ToolDefinition[];
  sharedPacks: SharedPolicyPacks;
  toolRegistryVersion: string;
}

/**
 * Load the built-in definitions from the build-time generated module. Runtime
 * never scans directories, reads JSON, or accepts external paths (docs §4/§5).
 */
export function loadBuiltinDefinitions(): BuiltinDefinitions {
  const errors = validateModelObservationProfiles(RAW_TOOL_DEFINITIONS);
  if (errors.length > 0) {
    throw new Error(`Model-observation profile errors:\n${errors.join("\n")}`);
  }
  return {
    definitions: compileRawTools(RAW_TOOL_DEFINITIONS, SHARED_POLICY_PACKS),
    sharedPacks: SHARED_POLICY_PACKS,
    toolRegistryVersion: TOOL_REGISTRY_VERSION,
  };
}
