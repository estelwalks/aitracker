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
}

function canonicalRegistryString(defs: readonly ToolDefinition[]): string {
  // Project only the fields whose change must invalidate downstream caches:
  // id, reader keys, paths, session command, pricing rule ids. Sorted for
  // determinism regardless of insertion order.
  const projection = defs
    .map((def) => ({
      id: def.id,
      usage: def.capabilities.usage.reader ?? null,
      usagePaths: def.capabilities.usage.paths ?? [],
      skills: def.storage?.skills?.roots ?? [],
      skillsEnv: def.storage?.skills?.envHome ?? null,
      sessionReader: def.capabilities.sessions.reader ?? null,
      sessionCommand: def.capabilities.sessions.command ?? [],
      pricingRules: (def.pricing?.rules ?? []).map((r) => r.id),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(projection);
}

export function compileToolRegistry(
  defs: readonly ToolDefinition[],
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
    canonicalSource: canonicalRegistryString(defs),
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
  const matching = def.pricing.rules.filter((rule) => {
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
// Default-registry convenience wrappers (compiled lazily from TOOL_DEFINITIONS).
// Used by migrated consumers. M1 tests exercise compileToolRegistry directly;
// these wrappers are covered once M2 populates TOOL_DEFINITIONS.

let _default: CompiledRegistry | null = null;
export function getDefaultRegistry(): CompiledRegistry {
  if (!_default) _default = compileToolRegistry(TOOL_DEFINITIONS);
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
      const mode = def.capabilities[cap].mode;
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
