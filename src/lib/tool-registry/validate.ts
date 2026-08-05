/**
 * Pure validation for tool definitions. Returns aggregated diagnostics rather
 * than throwing, so a single compile reports every problem. Used at module load
 * (dev/CI aborts on errors), by the verify script, and by tests.
 */
import type {
  ModelMatcher,
  ToolDefinition,
  UsageReaderKey,
  SessionReaderKey,
} from "./contracts.ts";
import { matchModel, normalizeModel } from "./contracts.ts";

export type DiagnosticSeverity = "error" | "warning";

export interface ValidationDiagnostic {
  toolId: string;
  severity: DiagnosticSeverity;
  /** Stable code for test assertions / filtering. */
  code: string;
  message: string;
}

export const BUILTIN_USAGE_READERS: ReadonlySet<string> = new Set([
  "generic",
  "generic-json",
  "generic-jsonl",
  "generic-sqlite",
  "claude-rollout-v1",
  "codex-rollout-v1",
  "workbuddy-native",
]);

export const BUILTIN_SESSION_READERS: ReadonlySet<string> = new Set([
  "claude-session-v1",
  "codex-session-v1",
  "grok-session-v1",
]);

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function isAbsoluteLike(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(path)
  );
}

/** A path segment is unsafe if absolute, traverses parent, contains NUL, or is empty. */
export function isUnsafePath(path: string): boolean {
  if (path === "") return true;
  if (path.includes("\0")) return true;
  if (isAbsoluteLike(path)) return true;
  return path.split(/[\\/]+/u).includes("..");
}

function exampleModels(matcher: ModelMatcher): string[] {
  if (matcher.kind === "exactOrSnapshot") {
    return matcher.names.flatMap((name) => {
      const n = normalizeModel(name);
      return [n, `${n}-20`];
    });
  }
  return [matcher.parts.join("-")];
}

/**
 * Two matchers "share a model" when an example of one is matched by the other.
 * Used for same-priority overlap detection. Conservative: catches the common
 * overlap shapes (identical names, general-vs-specific includesAll) without
 * false positives on provably-distinct rules.
 */
function matchersShareModel(a: ModelMatcher, b: ModelMatcher): boolean {
  const aExamples = exampleModels(a).map(normalizeModel);
  const bExamples = exampleModels(b).map(normalizeModel);
  return (
    aExamples.some((m) => matchModel(b, m)) ||
    bExamples.some((m) => matchModel(a, m))
  );
}

function dateRangesOverlap(
  aFrom: string,
  aTo: string | undefined,
  bFrom: string,
  bTo: string | undefined,
): boolean {
  const aStart = aFrom;
  const aEnd = aTo ?? "9999-12-31";
  const bStart = bFrom;
  const bEnd = bTo ?? "9999-12-31";
  return aStart <= bEnd && bStart <= aEnd;
}

function isValidMatcher(matcher: ModelMatcher): boolean {
  if (matcher.kind === "exactOrSnapshot") {
    return matcher.names.length > 0 && matcher.names.every((n) => n.length > 0);
  }
  return matcher.parts.length > 0 && matcher.parts.every((p) => p.length > 0);
}

export function validateToolDefinitions(
  defs: readonly ToolDefinition[],
): ValidationDiagnostic[] {
  const diags: ValidationDiagnostic[] = [];
  const seenIds = new Set<string>();
  const knownUsageReaders = new Set<string>(BUILTIN_USAGE_READERS);
  const knownSessionReaders = new Set<string>(BUILTIN_SESSION_READERS);

  function diag(
    toolId: string,
    code: string,
    message: string,
    severity: DiagnosticSeverity = "error",
  ): void {
    diags.push({ toolId, severity, code, message });
  }

  for (const def of defs) {
    const id = def.id;

    if (!ID_PATTERN.test(id)) {
      diag(
        id,
        "invalid-id",
        `id "${id}" must be kebab-case (lowercase, start with a letter)`,
      );
    }
    if (seenIds.has(id)) {
      diag(id, "duplicate-id", `duplicate tool id "${id}"`);
    }
    seenIds.add(id);

    if (def.configVersion !== 1) {
      diag(
        id,
        "invalid-config-version",
        `configVersion must be 1 (got ${String(def.configVersion)})`,
      );
    }

    if (!def.display.nameZh)
      diag(id, "empty-name-zh", "display.nameZh must be non-empty");
    if (!def.display.name)
      diag(id, "empty-name", "display.name must be non-empty");

    for (const root of def.detection.roots) {
      if (isUnsafePath(root))
        diag(id, "unsafe-detection-root", `detection root "${root}" is unsafe`);
    }

    // Storage path safety.
    const skills = def.storage?.skills;
    if (skills) {
      for (const root of skills.roots) {
        if (isUnsafePath(root))
          diag(id, "unsafe-skill-root", `skill root "${root}" is unsafe`);
      }
      if (
        skills.envHome !== undefined &&
        !ENV_VAR_PATTERN.test(skills.envHome)
      ) {
        diag(
          id,
          "invalid-env-home",
          `skills.envHome "${skills.envHome}" is not a valid env var name`,
        );
      }
    }
    const agents = def.storage?.agents;
    if (agents) {
      for (const root of agents.roots) {
        if (isUnsafePath(root))
          diag(id, "unsafe-agent-root", `agent root "${root}" is unsafe`);
      }
    }
    for (const dataRoot of def.storage?.dataRoots ?? []) {
      if (isUnsafePath(dataRoot.path)) {
        diag(id, "unsafe-data-root", `dataRoot "${dataRoot.path}" is unsafe`);
      }
    }

    // Usage capability.
    const usage = def.capabilities.usage;
    if (usage.mode === "unsupported") {
      if (usage.reader !== undefined || usage.paths !== undefined) {
        diag(
          id,
          "unsupported-usage-has-reader",
          "usage.mode=unsupported must not declare reader or paths",
        );
      }
    } else {
      if (usage.reader === undefined) {
        diag(
          id,
          "usage-missing-reader",
          `usage.mode=${usage.mode} requires a reader key`,
        );
      } else if (!knownUsageReaders.has(usage.reader)) {
        diag(
          id,
          "unknown-usage-reader",
          `usage reader "${usage.reader}" is not registered`,
        );
      }
      if (!usage.paths || usage.paths.length === 0) {
        diag(
          id,
          "usage-missing-paths",
          `usage.mode=${usage.mode} requires at least one path`,
        );
      } else {
        for (const path of usage.paths) {
          if (isUnsafePath(path.root))
            diag(
              id,
              "unsafe-usage-root",
              `usage path root "${path.root}" is unsafe`,
            );
        }
      }
    }

    // Skills capability.
    const skillsCap = def.capabilities.skills;
    if (skillsCap.mode !== "unsupported") {
      if (!skills || skills.roots.length === 0) {
        diag(
          id,
          "skills-without-storage",
          `skills.mode=${skillsCap.mode} requires storage.skills with roots`,
        );
      }
    }

    // Agents capability.
    const agentsCap = def.capabilities.agents;
    if (agentsCap.mode === "read") {
      if (!agents || agents.roots.length === 0) {
        diag(
          id,
          "agents-read-without-storage",
          "agents.mode=read requires storage.agents with roots",
        );
      }
    }

    // Sessions capability.
    const sessions = def.capabilities.sessions;
    if (sessions.mode === "resume") {
      if (sessions.reader === undefined) {
        diag(
          id,
          "sessions-missing-reader",
          "sessions.mode=resume requires a reader key",
        );
      } else if (!knownSessionReaders.has(sessions.reader)) {
        diag(
          id,
          "unknown-session-reader",
          `session reader "${sessions.reader}" is not registered`,
        );
      }
      if (!sessions.command || sessions.command.length === 0) {
        diag(
          id,
          "sessions-missing-command",
          "sessions.mode=resume requires a command template",
        );
      } else {
        if (!sessions.command.includes("{sessionId}")) {
          diag(
            id,
            "sessions-command-no-placeholder",
            "sessions.command must contain a {sessionId} token",
          );
        }
        for (const token of sessions.command) {
          if (token.includes("\0"))
            diag(
              id,
              "unsafe-session-command",
              "session command token contains NUL",
            );
        }
      }
    } else if (
      sessions.reader !== undefined ||
      sessions.command !== undefined
    ) {
      diag(
        id,
        "unsupported-sessions-has-config",
        "sessions.mode=unsupported must not declare reader or command",
      );
    }

    // Market capability: install-target requires writable skills.
    const market = def.capabilities.market;
    if (market.mode === "install-target") {
      if (
        skillsCap.mode !== "read-write" ||
        !skills ||
        skills.roots.length === 0
      ) {
        diag(
          id,
          "market-without-skills",
          "market.mode=install-target requires skills.mode=read-write with roots",
        );
      }
    }

    // Pricing rules.
    const pricing = def.pricing;
    if (pricing) {
      const ruleIds = new Set<string>();
      for (const rule of pricing.rules) {
        if (ruleIds.has(rule.id)) {
          diag(
            id,
            "duplicate-price-rule",
            `duplicate pricing rule id "${rule.id}"`,
          );
        }
        ruleIds.add(rule.id);
        if (!isValidMatcher(rule.match)) {
          diag(
            id,
            "invalid-price-matcher",
            `pricing rule "${rule.id}" has an invalid matcher`,
          );
        }
        if (!DATE_PATTERN.test(rule.effectiveFrom)) {
          diag(
            id,
            "invalid-effective-from",
            `pricing rule "${rule.id}" effectiveFrom must be YYYY-MM-DD`,
          );
        }
        if (
          rule.effectiveTo !== undefined &&
          !DATE_PATTERN.test(rule.effectiveTo)
        ) {
          diag(
            id,
            "invalid-effective-to",
            `pricing rule "${rule.id}" effectiveTo must be YYYY-MM-DD`,
          );
        }
      }
      // Same-priority overlap detection.
      for (let i = 0; i < pricing.rules.length; i += 1) {
        for (let j = i + 1; j < pricing.rules.length; j += 1) {
          const a = pricing.rules[i];
          const b = pricing.rules[j];
          const samePriority = (a.priority ?? 0) === (b.priority ?? 0);
          if (
            samePriority &&
            dateRangesOverlap(
              a.effectiveFrom,
              a.effectiveTo,
              b.effectiveFrom,
              b.effectiveTo,
            ) &&
            matchersShareModel(a.match, b.match)
          ) {
            diag(
              id,
              "price-rule-overlap",
              `pricing rules "${a.id}" and "${b.id}" overlap (same priority, overlapping dates, shared models)`,
            );
          }
        }
      }
    }
  }

  return diags;
}

/** True when no error-severity diagnostics are present. */
export function isValid(defs: readonly ToolDefinition[]): boolean {
  return validateToolDefinitions(defs).every((d) => d.severity !== "error");
}
