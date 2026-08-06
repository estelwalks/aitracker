/**
 * Pure projection of tool definitions into a browser-safe manifest. Contains
 * ONLY display fields and capability mode status - never paths, reader keys,
 * env var names, resume commands, or pricing rates. A prebuild script
 * (`scripts/generate-tool-manifest.mjs`) serializes this into
 * `public-manifest.generated.ts`, which is the ONLY registry-derived module the
 * browser bundle imports.
 */
import type { ToolDefinition } from "./contracts.ts";
import type { SharedPolicyPacks } from "./schema.ts";

export type PublicCapabilityMode = string;

export interface PublicCapabilityStatus {
  usage: "native" | "adapter" | "unsupported";
  skills: "read-write" | "read" | "unsupported";
  agents: "read" | "unsupported";
  sessions: "resume" | "unsupported";
  market: "install-target" | "unsupported";
  security: "scan" | "unsupported";
}

export interface PublicTool {
  id: string;
  name: string;
  nameZh: string;
  icon?: string;
  capabilities: PublicCapabilityStatus;
}

export interface PublicToolManifest {
  configVersion: 1;
  tools: readonly PublicTool[];
  /** Canonical skill-agent UI order (from skill-market-policy.json). */
  skillAgentOrder?: readonly string[];
}

export function generatePublicManifest(
  defs: readonly ToolDefinition[],
  sharedPacks?: SharedPolicyPacks,
): PublicToolManifest {
  return {
    configVersion: 1,
    tools: defs
      .filter((def) => def.catalogVisible !== false)
      .map((def) => ({
        id: def.id,
        name: def.display.name,
        nameZh: def.display.nameZh,
        ...(def.display.icon ? { icon: def.display.icon } : {}),
        capabilities: {
          usage: def.capabilities.usage.mode,
          skills: def.capabilities.skills.mode,
          agents: def.capabilities.agents.mode,
          sessions: def.capabilities.sessions.mode,
          market: def.capabilities.market.mode,
          security: def.capabilities.security.mode,
        },
      })),
    ...(sharedPacks
      ? { skillAgentOrder: sharedPacks.skillMarketPolicy.skillAgentOrder }
      : {}),
  };
}

/**
 * Substrings that must NEVER appear in a serialized manifest. If any are found,
 * the manifest projection is leaking sensitive config into the browser bundle.
 * Kept here so the generator script and the safety test share one source.
 */
export const FORBIDDEN_MANIFEST_TOKENS: readonly string[] = [
  "CODEX_HOME",
  "GROK_HOME",
  "{sessionId}",
  "--resume",
  "rollout",
  "generic-json",
  "generic-jsonl",
  "generic-sqlite",
  "session-v1",
  "UsdPerMillion",
  "effectiveFrom",
  "effectiveTo",
  "AppData",
  "Library/",
  ".claude",
  ".codex",
  ".config/",
  // v1.5 fields that must never reach the browser bundle (docs §5/§7).
  "locations",
  "rulePackRefs",
  "billingMode",
  "fallbackProfileRef",
  "platform-profiles",
  "appData",
  "userProfile",
  "configHome",
  "dataHome",
  "tool.json",
];

/** True when a serialized manifest contains no forbidden token. */
export function manifestIsSafe(manifest: PublicToolManifest): boolean {
  const serialized = JSON.stringify(manifest);
  return FORBIDDEN_MANIFEST_TOKENS.every(
    (token) => !serialized.includes(token),
  );
}
