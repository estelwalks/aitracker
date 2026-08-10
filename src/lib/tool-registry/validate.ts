/**
 * Pure validation for tool definitions. Returns aggregated diagnostics rather
 * than throwing, so a single compile reports every problem. Used at module load
 * (dev/CI aborts on errors), by the verify script, and by tests.
 */
import type {
  ToolDefinition,
  UsageReaderKey,
  SessionReaderKey,
} from "./contracts.ts";

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

export const BUILTIN_CONTEXT_READERS: ReadonlySet<string> = new Set([
  "claude-context-v1",
  "codex-context-v1",
]);

const PLATFORM_TARGETS = new Set(["macos", "windows10", "windows11", "linux"]);
const PLATFORM_STATUSES = new Set(["supported", "planned", "unsupported"]);

const ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const ENV_VAR_PATTERN = /^[A-Z][A-Z0-9_]*$/u;

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

    // v1.5 platform-aware fields (defensive; the JSON schema already enforces).
    const platforms = def.platforms;
    if (platforms) {
      for (const [target, status] of Object.entries(platforms)) {
        if (
          target === "windows" ||
          target === "windows10" ||
          target === "windows11"
        )
          continue;
        if (!PLATFORM_TARGETS.has(target)) {
          diag(
            id,
            "invalid-platform-target",
            `unknown platform target "${target}"`,
          );
        }
        if (!PLATFORM_STATUSES.has(status)) {
          diag(
            id,
            "invalid-platform-status",
            `invalid platform status "${status}" for ${target}`,
          );
        }
      }
    }
    const locations = def.detection.locations;
    if (locations) {
      const seenDeclarations = new Set<string>();
      for (const loc of locations) {
        const key = JSON.stringify({
          targets: [...loc.targets].sort(),
          base: loc.base,
          path: loc.path,
        });
        if (seenDeclarations.has(key)) {
          diag(
            id,
            "duplicate-platform-location",
            `duplicate detection location (same targets/base/path) fails the build`,
          );
        }
        seenDeclarations.add(key);
        if (isUnsafePath(loc.path)) {
          diag(
            id,
            "unsafe-detection-location",
            `detection location path "${loc.path}" is unsafe`,
          );
        }
      }
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

    // Context capability (v1.5): native needs a registered reader.
    const context = def.capabilities.context;
    if (context) {
      if (context.mode === "native") {
        if (context.reader === undefined) {
          diag(
            id,
            "context-missing-reader",
            "context.mode=native requires a reader key",
          );
        } else if (!BUILTIN_CONTEXT_READERS.has(context.reader)) {
          diag(
            id,
            "unknown-context-reader",
            `context reader "${context.reader}" is not registered`,
          );
        }
      } else if (context.mode === "unsupported") {
        if (context.reader !== undefined || context.dimensions !== undefined) {
          diag(
            id,
            "unsupported-context-has-config",
            "context.mode=unsupported must not declare reader or dimensions",
          );
        }
      } else if (!context.dimensions?.length) {
        diag(
          id,
          "context-missing-dimensions",
          "context.mode=heuristic requires dimensions",
        );
      }
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

    // P1-1: tools no longer hold pricing policy (billingMode/fallbackProfileRef/
    // rulePackRefs) or legacy inline rate rules - pricing ownership moved to
    // billing routes (pricing/contracts.ts + resolve.ts). The only per-tool
    // pricing declaration is `modelObservation` (evidence extraction), which is
    // schema-validated (schema.ts) and whose normalize profile is verified by
    // the loader (`validateModelObservationProfiles`).
  }

  return diags;
}

/** True when no error-severity diagnostics are present. */
export function isValid(defs: readonly ToolDefinition[]): boolean {
  return validateToolDefinitions(defs).every((d) => d.severity !== "error");
}
