/**
 * Tool registry compiler and runtime API.
 *
 * Pure (no node imports) so it can be imported by server modules and the
 * manifest generator. The browser must NOT import this module - it imports the
 * generated `public-manifest.generated.ts` instead, which contains only the
 * safe projection produced by `generatePublicManifest`.
 */
import {
  type PlatformStatus,
  type PlatformTarget,
  type ToolDefinition,
  type UsageFieldMapping,
  type UsagePathSpec,
  type UsageReaderKey,
  type SessionReaderKey,
} from "./contracts.ts";
import {
  generatePublicManifest,
  type PublicTool,
  type PublicToolManifest,
} from "./manifest.ts";
import {
  validateToolDefinitions,
  type ValidationDiagnostic,
} from "./validate.ts";
import type { PlatformProfiles, SharedPolicyPacks } from "./schema.ts";
import {
  loadBuiltinDefinitions,
  projectBase,
  projectBaseWithEnv,
  type ProjectedPath,
} from "./loader.ts";

export interface UsagePlan {
  toolId: string;
  mode: "native" | "adapter";
  reader: UsageReaderKey;
  paths: readonly UsagePathSpec[];
  mapping?: UsageFieldMapping;
  maxFileSizeBytes?: number;
  query?: string;
}

/**
 * Browser presentation metadata is kept next to the registry rather than in a
 * page-local list.  These values describe the product surface only; they do
 * not disclose paths, commands, or parser configuration.
 */
export type ToolSurface = "cli" | "ide" | "plugin" | "desktop";

const TOOL_SURFACES: Readonly<Record<string, ToolSurface>> = {
  "claude-code": "cli",
  codex: "cli",
  cursor: "ide",
  kiro: "ide",
  "gemini-cli": "cli",
  opencode: "cli",
  openclaw: "cli",
  "every-code": "cli",
  hermes: "cli",
  "github-copilot": "plugin",
  "kimi-code": "cli",
  omp: "cli",
  codebuddy: "cli",
  workbuddy: "cli",
  grok: "cli",
  "kilo-cli": "cli",
  kilocode: "plugin",
  antigravity: "desktop",
  pi: "cli",
  craft: "cli",
  "roo-code": "plugin",
  zed: "ide",
  goose: "cli",
  droid: "cli",
  mimo: "cli",
  zcode: "cli",
  anythingllm: "desktop",
  aipy: "cli",
  cline: "plugin",
};

/**
 * Only verified vendor-owned links are listed. A null value is intentional:
 * the Sources UI must show the link as unavailable rather than fabricate a
 * search-engine URL.
 */
const OFFICIAL_DOWNLOAD_URLS: Readonly<Record<string, string | null>> = {
  "claude-code": "https://docs.anthropic.com/en/docs/claude-code/overview",
  codex: "https://developers.openai.com/codex/cli/",
  cursor: "https://www.cursor.com/downloads",
  kiro: "https://kiro.dev/",
  "gemini-cli": "https://geminicli.com/",
  opencode: "https://opencode.ai/",
  openclaw: "https://openclaw.ai/",
  "every-code": "https://github.com/just-every/code",
  hermes: "https://hermes-agent.nousresearch.com/",
  "github-copilot": "https://github.com/features/copilot",
  "kimi-code": "https://www.kimi.com/code",
  omp: "https://github.com/can1357/oh-my-pi",
  codebuddy: "https://cloud.tencent.com/product/acc",
  workbuddy: "https://copilot.tencent.com/work/",
  grok: "https://x.ai/grok",
  "kilo-cli": "https://kilo.ai/cli",
  kilocode: "https://kilocode.ai/",
  antigravity: "https://antigravity.google/download",
  pi: "https://pi.dev/",
  craft: "https://agents.craft.do/",
  "roo-code": "https://roocode.com/",
  zed: "https://zed.dev/download",
  goose: "https://goose-docs.ai/",
  droid: "https://factory.ai/product/droids",
  mimo: "https://mimo.xiaomi.com/index",
  zcode: "https://zcode.z.ai/en",
  anythingllm: "https://anythingllm.com/",
  aipy: "https://www.aipyaipy.com/",
  cline: "https://cline.bot/",
  dsh: "https://www.deepseek.com/harness/en/",
  qwen: "https://qwen.ai/download",
  commandcode: "https://commandcode.ai/",
  proma: "https://proma.cool/download",
  qodercn: "https://qoder.com.cn/",
  reasonix: "https://reasonix.io/",
  cherrystudio: "https://www.cherryai.com/",
};

export function toolSurfaceFor(toolId: string): ToolSurface {
  return TOOL_SURFACES[toolId] ?? "cli";
}

export function officialDownloadUrlFor(toolId: string): string | null {
  return OFFICIAL_DOWNLOAD_URLS[toolId] ?? null;
}

export interface SessionPlan {
  toolId: string;
  reader: SessionReaderKey;
  command: readonly string[];
}

export interface ListToolsFilter {
  capability?: keyof ToolDefinition["capabilities"];
  /** Only tools whose given capability mode is not "unsupported". */
  supportedOnly?: boolean;
}

export interface CompiledRegistry {
  readonly definitions: readonly ToolDefinition[];
  readonly diagnostics: readonly ValidationDiagnostic[];
  readonly byId: ReadonlyMap<string, ToolDefinition>;
  readonly ids: readonly string[];
  readonly publicManifest: PublicToolManifest;
  /** Deterministic canonical string (input to the sha256 fingerprint). */
  readonly canonicalSource: string;
  /** v1.5 shared policy packs (present when compiled from the JSON loader). */
  readonly sharedPacks?: SharedPolicyPacks;
}

/** Deterministic stringify: recursively sorted keys (docs §8.1 canonical). */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Full canonical JSON over every definition plus the shared packs (D6): any
 * JSON change invalidates downstream caches (usage cache fingerprint).
 */
function canonicalRegistryString(
  defs: readonly ToolDefinition[],
  packs?: SharedPolicyPacks,
): string {
  return stableStringify({
    definitions: defs,
    sharedPacks: packs ?? null,
  });
}

export interface CompileToolRegistryOptions {
  /** v1.5 shared policy packs (from the JSON loader). */
  sharedPacks?: SharedPolicyPacks;
}

export function compileToolRegistry(
  defs: readonly ToolDefinition[],
  options?: CompileToolRegistryOptions,
): CompiledRegistry {
  const diagnostics = validateToolDefinitions(defs);
  const byId = new Map<string, ToolDefinition>();
  for (const def of defs) byId.set(def.id, def);
  return {
    definitions: defs,
    diagnostics,
    byId,
    ids: defs.map((def) => def.id),
    publicManifest: generatePublicManifest(defs, options?.sharedPacks),
    canonicalSource: canonicalRegistryString(defs, options?.sharedPacks),
    ...(options?.sharedPacks ? { sharedPacks: options.sharedPacks } : {}),
  };
}

/** Pure per-tool usage plan (no env/path resolution). */
export function getUsagePlanFor(def: ToolDefinition): UsagePlan | null {
  const usage = def.capabilities.usage;
  if (usage.mode === "unsupported" || !usage.reader || !usage.paths)
    return null;
  return {
    toolId: def.id,
    mode: usage.mode,
    reader: usage.reader,
    paths: usage.paths,
    ...(usage.mapping ? { mapping: usage.mapping } : {}),
    ...(usage.maxFileSizeBytes !== undefined
      ? { maxFileSizeBytes: usage.maxFileSizeBytes }
      : {}),
    ...(usage.query ? { query: usage.query } : {}),
  };
}

/** Pure per-tool session plan. */
export function getSessionPlanFor(def: ToolDefinition): SessionPlan | null {
  const sessions = def.capabilities.sessions;
  if (sessions.mode === "unsupported" || !sessions.reader) {
    return null;
  }
  return {
    toolId: def.id,
    reader: sessions.reader,
    command: sessions.command ?? [],
  };
}

// ---------------------------------------------------------------------------
// Default-registry convenience wrappers. Compiled lazily from the v1.5 JSON
// definitions (definitions.generated.ts) via the loader - runtime never reads
// JSON or scans directories.

let _default: CompiledRegistry | null = null;
export function getDefaultRegistry(): CompiledRegistry {
  if (!_default) {
    const builtin = loadBuiltinDefinitions();
    _default = compileToolRegistry(builtin.definitions, {
      sharedPacks: builtin.sharedPacks,
    });
  }
  return _default;
}

/** Reset the cached default registry (test/override reload hook). */
export function __resetDefaultRegistry(): void {
  _default = null;
}

export function getTool(id: string): ToolDefinition | undefined {
  return getDefaultRegistry().byId.get(id);
}

export function requireTool(id: string): ToolDefinition {
  const def = getTool(id);
  if (!def) throw new Error(`Unknown tool id: "${id}"`);
  return def;
}

export function listTools(filter?: ListToolsFilter): ToolDefinition[] {
  const registry = getDefaultRegistry();
  let defs = [...registry.definitions];
  if (filter?.capability) {
    const cap = filter.capability;
    defs = defs.filter((def) => {
      // `context` is optional (v1.5); a missing capability is "unsupported".
      const mode = def.capabilities[cap]?.mode ?? "unsupported";
      return filter.supportedOnly ? mode !== "unsupported" : true;
    });
  }
  return defs;
}

export function getUsagePlan(id: string): UsagePlan | null {
  const def = getTool(id);
  return def ? getUsagePlanFor(def) : null;
}

export function getSessionPlan(id: string): SessionPlan | null {
  const def = getTool(id);
  return def ? getSessionPlanFor(def) : null;
}

export function getPublicTools(): readonly PublicTool[] {
  return getDefaultRegistry().publicManifest.tools;
}

// ---------------------------------------------------------------------------
// v1.5 platform-aware API (docs §6.1/§7). Resolution priority: shared default
// < platform group < platform target < tool definition.
// ---------------------------------------------------------------------------

export type PlatformOs = "macos" | "windows" | "linux";
export type PlanCapability = "detection" | "usage" | "skills" | "sessions";

/** Environment available to path resolution (XDG vars, `env:NAME` bases). */
export type PlatformEnv = Readonly<Record<string, string | undefined>>;

/** A location that produced no path for the resolved plan, with a reason. */
export interface SkippedLocation {
  base: string;
  path: string;
  reason: string;
}

export interface PlatformPathPlan {
  toolId: string;
  capability: PlanCapability;
  os: PlatformOs;
  /** Effective per-target status (windows group resolved to its targets). */
  status: PlatformStatus;
  /** Flattened HOME-relative paths to scan for this (os, capability). */
  paths: readonly string[];
  /**
   * Locations skipped because their base is not usable on the current targets
   * per platform-profiles.basePlatforms (or cannot be flattened without an
   * environment). Absent when nothing was skipped (F5-T2 diagnostics).
   */
  skippedLocations?: readonly SkippedLocation[];
}

/** A plan path with its resolution provenance (F5-T1 env/XDG resolution). */
export interface ResolvedPlatformPath {
  /** HOME-relative when `homeRelative` is true, else self-contained. */
  path: string;
  /** The base the path was projected from (absent for usage roots). */
  base?: string;
  homeRelative: boolean;
}

export interface PlatformPathsResolution {
  toolId: string;
  capability: PlanCapability;
  os: PlatformOs;
  status: PlatformStatus;
  paths: readonly ResolvedPlatformPath[];
  skippedLocations: readonly SkippedLocation[];
}

/** Expand an os to its platform targets (windows -> the windows group). */
export function osTargets(os: PlatformOs): readonly PlatformTarget[] {
  if (os === "windows") return ["windows10", "windows11"];
  return [os];
}

/**
 * Effective platform status for a tool on an os: exact target status, then the
 * windows group, then the shared default from platform-profiles
 * (`defaultStatus`; legacy configs without a profile and without `platforms`
 * behave as all-supported).
 */
function platformStatusFor(
  def: ToolDefinition,
  os: PlatformOs,
  profiles?: PlatformProfiles,
): PlatformStatus {
  const platforms = def.platforms;
  if (platforms) {
    for (const target of osTargets(os)) {
      const exact = platforms[target];
      if (exact !== undefined) return exact;
    }
    if (os === "windows" && platforms.windows !== undefined) {
      return platforms.windows;
    }
  }
  if (profiles) return profiles.defaultStatus[os];
  return "supported";
}

/**
 * F5-T2: is `base` declared for any of `targets` in platform-profiles?
 * `env:NAME` bases are runtime-resolved and never declared in basePlatforms,
 * so they are always "applicable" and only fail when the variable is unset.
 * Without a profile (legacy registries) every base is applicable.
 */
function baseApplicableToTargets(
  profiles: PlatformProfiles | undefined,
  base: string,
  targets: readonly PlatformTarget[],
): boolean {
  if (!profiles) return true;
  if (base.startsWith("env:")) return true;
  const declared = profiles.basePlatforms[base];
  return declared !== undefined && declared.some((t) => targets.includes(t));
}

interface BasePathEntry {
  base: string;
  path: string;
}

/**
 * The (base, path) entries for base-bearing capabilities: detection locations
 * (already filtered by their declared targets), skills rootSpecs, sessions
 * dataRoots. Usage paths carry no base after compilation and are handled
 * separately (their roots are final HOME-relative suffixes).
 */
function platformEntriesFor(
  def: ToolDefinition,
  capability: PlanCapability,
  targets: readonly PlatformTarget[],
): readonly BasePathEntry[] {
  if (capability === "detection") {
    return (def.detection.locations ?? [])
      .filter((loc) => loc.targets.some((t) => targets.includes(t)))
      .map((loc) => ({ base: loc.base, path: loc.path }));
  }
  if (capability === "skills") {
    const rootSpecs = def.storage?.skills?.rootSpecs;
    return rootSpecs?.length
      ? rootSpecs.map((r) => ({ base: r.base, path: r.path }))
      : [];
  }
  // sessions: roots are the tool's data roots.
  return (def.storage?.dataRoots ?? []).map((r) => ({
    base: r.base,
    path: r.path,
  }));
}

/**
 * Shared per-capability collection: base-target validation (F5-T2) plus
 * projection. `env` switches the projection to the env-aware variant
 * (`projectBaseWithEnv`); when undefined, the legacy pure projection applies
 * and `env:NAME`/unprojectable bases are skipped with a diagnostic.
 */
function collectPlatformPaths(
  def: ToolDefinition,
  capability: PlanCapability,
  targets: readonly PlatformTarget[],
  profiles: PlatformProfiles | undefined,
  env: PlatformEnv | undefined,
): { paths: ResolvedPlatformPath[]; skipped: SkippedLocation[] } {
  const paths: ResolvedPlatformPath[] = [];
  const skipped: SkippedLocation[] = [];

  if (capability === "usage") {
    for (const p of def.capabilities.usage.paths ?? []) {
      if (
        p.targets === undefined ||
        p.targets.some((t) => targets.includes(t))
      ) {
        paths.push({ path: p.root, homeRelative: true });
      }
    }
    return { paths, skipped };
  }

  if (capability === "skills") {
    const skills = def.storage?.skills;
    if (!skills?.rootSpecs?.length) {
      // Pre-v1.5 flattened roots (no base) are final HOME-relative suffixes.
      for (const root of skills?.roots ?? []) {
        paths.push({ path: root, homeRelative: true });
      }
      return { paths, skipped };
    }
  }

  const project = env
    ? (base: string, path: string): ProjectedPath | null =>
        projectBaseWithEnv(base, path, env)
    : (base: string, path: string): ProjectedPath | null => {
        const projected = projectBase(base, path);
        return projected === null
          ? null
          : { path: projected, homeRelative: true };
      };
  const targetLabel = targets.join("/");
  for (const entry of platformEntriesFor(def, capability, targets)) {
    if (!baseApplicableToTargets(profiles, entry.base, targets)) {
      skipped.push({
        base: entry.base,
        path: entry.path,
        reason: `base "${entry.base}" is not declared for target(s) ${targetLabel} in platform-profiles.basePlatforms`,
      });
      continue;
    }
    const projected = project(entry.base, entry.path);
    if (projected === null) {
      skipped.push({
        base: entry.base,
        path: entry.path,
        reason: env
          ? `no environment value for base "${entry.base}" (variable unset)`
          : `base "${entry.base}" has no flattened HOME-relative default`,
      });
      continue;
    }
    paths.push({
      path: projected.path,
      base: entry.base,
      homeRelative: projected.homeRelative,
    });
  }
  return { paths, skipped };
}

/** Dedupe resolved paths by their final string, preserving order. */
function dedupePaths(
  paths: readonly ResolvedPlatformPath[],
): ResolvedPlatformPath[] {
  const seen = new Set<string>();
  const out: ResolvedPlatformPath[] = [];
  for (const p of paths) {
    if (seen.has(p.path)) continue;
    seen.add(p.path);
    out.push(p);
  }
  return out;
}

/**
 * Resolve the unique per-platform plan for a tool capability (docs §6.1).
 * `linux: planned` never produces scan paths; status "planned"/"unsupported"
 * yields an empty path list. Paths are the flattened HOME-relative form (the
 * env-aware variant lives in `resolvePlatformPaths`).
 */
export function resolvePlatformPlan(
  toolId: string,
  capability: PlanCapability,
  os: PlatformOs,
  registry: CompiledRegistry = getDefaultRegistry(),
): PlatformPathPlan | null {
  const def = registry.byId.get(toolId);
  if (!def) return null;
  const targets = osTargets(os);
  const profiles = registry.sharedPacks?.platformProfiles;
  const status = platformStatusFor(def, os, profiles);
  if (status !== "supported") {
    return { toolId, capability, os, status, paths: [] };
  }
  const { paths, skipped } = collectPlatformPaths(
    def,
    capability,
    targets,
    profiles,
    undefined,
  );
  const plan: PlatformPathPlan = {
    toolId,
    capability,
    os,
    status,
    paths: dedupePaths(paths).map((p) => p.path),
  };
  if (skipped.length > 0) plan.skippedLocations = skipped;
  return plan;
}

/**
 * Env-aware platform path resolution (F5-T1 XDG support): `configHome`/
 * `dataHome` honor `XDG_CONFIG_HOME`/`XDG_DATA_HOME` (absolute when set,
 * `xdgFallback` when unset) and `env:NAME` bases resolve to `$NAME/path`.
 * The same base-target validation as `resolvePlatformPlan` applies.
 */
export function resolvePlatformPaths(
  toolId: string,
  capability: PlanCapability,
  os: PlatformOs,
  env: PlatformEnv,
  registry: CompiledRegistry = getDefaultRegistry(),
): PlatformPathsResolution | null {
  const def = registry.byId.get(toolId);
  if (!def) return null;
  const targets = osTargets(os);
  const profiles = registry.sharedPacks?.platformProfiles;
  const status = platformStatusFor(def, os, profiles);
  if (status !== "supported") {
    return { toolId, capability, os, status, paths: [], skippedLocations: [] };
  }
  const { paths, skipped } = collectPlatformPaths(
    def,
    capability,
    targets,
    profiles,
    env,
  );
  return {
    toolId,
    capability,
    os,
    status,
    paths: dedupePaths(paths),
    skippedLocations: skipped,
  };
}

export interface SkillPlan {
  toolId: string;
  /** HOME-relative suffixes; `[0]` is the write path (envHome semantics kept). */
  roots: readonly string[];
  envHome?: string;
  markers: readonly string[];
  maxDepth: number;
}

/** Skill discovery plan (docs §7); env resolution happens at the consumer. */
export function getSkillPlan(
  toolId: string,
  _env?: Record<string, string | undefined>,
  registry: CompiledRegistry = getDefaultRegistry(),
): SkillPlan | null {
  const skills = registry.byId.get(toolId)?.storage?.skills;
  if (!skills) return null;
  return {
    toolId,
    roots: skills.roots,
    ...(skills.envHome ? { envHome: skills.envHome } : {}),
    markers: skills.markers ?? [],
    maxDepth: skills.maxDepth ?? 3,
  };
}

export interface AgentPlan {
  toolId: string;
  mode: "read" | "unsupported";
  roots: readonly string[];
}

export function getAgentPlan(
  toolId: string,
  registry: CompiledRegistry = getDefaultRegistry(),
): AgentPlan | null {
  const agents = registry.byId.get(toolId)?.storage?.agents;
  if (!agents) return null;
  return { toolId, mode: agents.mode, roots: agents.roots };
}

export function getContextPlan(
  toolId: string,
  registry: CompiledRegistry = getDefaultRegistry(),
): ToolDefinition["capabilities"]["context"] | null {
  return registry.byId.get(toolId)?.capabilities.context ?? null;
}

/** Tool ids with session history support, in canonical order (docs §7). */
export function listSessionTools(
  registry: CompiledRegistry = getDefaultRegistry(),
): readonly string[] {
  return registry.definitions
    .filter((def) => def.capabilities.sessions.mode !== "unsupported")
    .map((def) => def.id);
}

export interface ToolDisplayInfo {
  id: string;
  name: string;
  nameZh: string;
  icon?: string;
  color?: string;
}

export function getToolDisplay(
  id: string,
  registry: CompiledRegistry = getDefaultRegistry(),
): ToolDisplayInfo | null {
  const def = registry.byId.get(id);
  if (!def) return null;
  return {
    id: def.id,
    name: def.display.name,
    nameZh: def.display.nameZh,
    ...(def.display.icon ? { icon: def.display.icon } : {}),
    ...(def.display.color ? { color: def.display.color } : {}),
  };
}

// Shared policy getters (null when compiled without packs - legacy path).
export function getGenericReaderDefaults(
  registry: CompiledRegistry = getDefaultRegistry(),
) {
  return registry.sharedPacks?.genericReaderDefaults ?? null;
}

export function getScannerPolicy(
  registry: CompiledRegistry = getDefaultRegistry(),
) {
  return registry.sharedPacks?.scannerPolicy ?? null;
}

export function getSkillMarketPolicy(
  registry: CompiledRegistry = getDefaultRegistry(),
) {
  return registry.sharedPacks?.skillMarketPolicy ?? null;
}

export function getUsageTaxonomy(
  registry: CompiledRegistry = getDefaultRegistry(),
) {
  return registry.sharedPacks?.usageTaxonomy ?? null;
}
