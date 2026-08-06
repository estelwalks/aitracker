/**
 * Tool registry compiler and runtime API.
 *
 * Pure (no node imports) so it can be imported by server modules and the
 * manifest generator. The browser must NOT import this module - it imports the
 * generated `public-manifest.generated.ts` instead, which contains only the
 * safe projection produced by `generatePublicManifest`.
 */
import {
  matchModel,
  normalizeModel,
  type ModelRateRule,
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
import { TOOL_DEFINITIONS } from "./tools/index.ts";
import type { SharedPolicyPacks } from "./schema.ts";
import { loadBuiltinDefinitions, projectBase } from "./loader.ts";

export interface UsagePlan {
  toolId: string;
  mode: "native" | "adapter";
  reader: UsageReaderKey;
  paths: readonly UsagePathSpec[];
  mapping?: UsageFieldMapping;
  maxFileSizeBytes?: number;
  query?: string;
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
    publicManifest: generatePublicManifest(defs),
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
  if (sessions.mode !== "resume" || !sessions.reader || !sessions.command) {
    return null;
  }
  return { toolId: def.id, reader: sessions.reader, command: sessions.command };
}

export interface FindModelRateInput {
  toolId: string;
  model: string;
  /** ISO date or datetime; defaults to today. */
  occurredAt?: string;
}

/** Find the best price rule for a (toolId, model, date) triple; null if none. */
export function findModelRateIn(
  registry: CompiledRegistry,
  input: FindModelRateInput,
): ModelRateRule | null {
  const def = registry.byId.get(input.toolId);
  if (!def?.pricing) return null;
  const normalized = normalizeModel(input.model);
  const date = (input.occurredAt ?? new Date().toISOString()).slice(0, 10);
  const matching = (def.pricing.rules ?? []).filter((rule) => {
    if (!matchModel(rule.match, normalized)) return false;
    if (rule.effectiveFrom > date) return false;
    if (rule.effectiveTo !== undefined && date > rule.effectiveTo) return false;
    return true;
  });
  if (matching.length === 0) return null;
  matching.sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) ||
      b.effectiveFrom.localeCompare(a.effectiveFrom),
  );
  return matching[0];
}

// ---------------------------------------------------------------------------
// Default-registry convenience wrappers. Compiled lazily from the v1.5 JSON
// definitions (definitions.generated.ts) via the loader - runtime never reads
// JSON or scans directories. `TOOL_DEFINITIONS` (the legacy TS configs) stays
// importable for the double-read parity tests until Phase 5 removes it.

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

export function findModelRate(input: FindModelRateInput): ModelRateRule | null {
  return findModelRateIn(getDefaultRegistry(), input);
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

export interface PlatformPathPlan {
  toolId: string;
  capability: PlanCapability;
  os: PlatformOs;
  /** Effective per-target status (windows group resolved to its targets). */
  status: PlatformStatus;
  /** Flattened HOME-relative paths to scan for this (os, capability). */
  paths: readonly string[];
}

/** Expand an os to its platform targets (windows -> the windows group). */
export function osTargets(os: PlatformOs): readonly PlatformTarget[] {
  if (os === "windows") return ["windows10", "windows11"];
  return [os];
}

/**
 * Effective platform status for a tool on an os: exact target status, then the
 * windows group, then the shared default (`supported`; legacy TS configs
 * without `platforms` behave as all-supported).
 */
function platformStatusFor(
  def: ToolDefinition,
  os: PlatformOs,
): PlatformStatus {
  const platforms = def.platforms;
  if (!platforms) return "supported";
  for (const target of osTargets(os)) {
    const exact = platforms[target];
    if (exact !== undefined) return exact;
  }
  if (os === "windows" && platforms.windows !== undefined) {
    return platforms.windows;
  }
  return "supported";
}

/**
 * Resolve the unique per-platform plan for a tool capability (docs §6.1).
 * `linux: planned` never produces scan paths; status "planned"/"unsupported"
 * yields an empty path list.
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
  const status = platformStatusFor(def, os);
  if (status !== "supported") {
    return { toolId, capability, os, status, paths: [] };
  }

  let paths: string[] = [];
  if (capability === "detection") {
    paths = (def.detection.locations ?? [])
      .filter((loc) => loc.targets.some((t) => targets.includes(t)))
      .map((loc) => projectLocationFor(loc))
      .filter((p): p is string => p !== null);
  } else if (capability === "usage") {
    paths = (def.capabilities.usage.paths ?? [])
      .filter(
        (p) =>
          p.targets === undefined || p.targets.some((t) => targets.includes(t)),
      )
      .map((p) => p.root);
  } else if (capability === "skills") {
    const skills = def.storage?.skills;
    if (skills?.rootSpecs?.length) {
      // rootSpecs have no explicit targets; their platform reach comes from
      // the base (basePlatforms in platform-profiles) - keep all roots when
      // any target matches the base, else fall back to all roots.
      paths = skills.rootSpecs
        .map((r) => projectLocationFor({ targets, base: r.base, path: r.path }))
        .filter((p): p is string => p !== null);
    } else {
      paths = [...(skills?.roots ?? [])];
    }
  } else {
    // sessions: roots are the tool's data roots / usage roots.
    paths = (def.storage?.dataRoots ?? [])
      .map((r) => projectLocationFor({ targets, base: r.base, path: r.path }))
      .filter((p): p is string => p !== null);
  }

  return { toolId, capability, os, status, paths: [...new Set(paths)] };
}

function projectLocationFor(loc: {
  targets: readonly PlatformTarget[];
  base: string;
  path: string;
}): string | null {
  return projectBase(loc.base, loc.path);
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

/** Session-resumable tool ids, in canonical order (docs §7). */
export function listSessionTools(
  registry: CompiledRegistry = getDefaultRegistry(),
): readonly string[] {
  return registry.definitions
    .filter((def) => def.capabilities.sessions.mode === "resume")
    .map((def) => def.id);
}

export interface ToolDisplayInfo {
  id: string;
  name: string;
  nameZh: string;
  icon?: string;
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

export interface PricingPolicyRefs {
  billingMode?: "api-metered" | "subscription" | "unsupported";
  fallbackProfileRef?: string;
  rulePackRefs: readonly string[];
}

/** Pricing policy metadata declared by the tool JSON (docs §8.2). */
export function getPricingPolicyRefs(
  toolId: string,
  registry: CompiledRegistry = getDefaultRegistry(),
): PricingPolicyRefs | null {
  const pricing = registry.byId.get(toolId)?.pricing;
  if (!pricing) return null;
  return {
    ...(pricing.billingMode ? { billingMode: pricing.billingMode } : {}),
    ...(pricing.fallbackProfileRef
      ? { fallbackProfileRef: pricing.fallbackProfileRef }
      : {}),
    rulePackRefs: pricing.rulePackRefs ?? [],
  };
}
