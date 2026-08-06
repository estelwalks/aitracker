/**
 * Converts the generated browser-safe registry manifest into Agent Directory
 * facts. This module must only accept PublicToolManifest, never ToolDefinition
 * or a compiled registry: the latter contain paths, commands and reader keys.
 */
import type {
  PublicTool,
  PublicToolManifest,
} from "../../lib/tool-registry/manifest.ts";
import type { AgentDefinition } from "./contracts.ts";

function projectAgentDefinition(tool: PublicTool): AgentDefinition {
  return {
    id: tool.id,
    name: tool.name,
    nameZh: tool.nameZh,
    ...(tool.icon ? { icon: tool.icon } : {}),
    ...(tool.legacy ? { legacy: true } : {}),
    capabilities: { ...tool.capabilities },
    platforms: { ...tool.platforms },
  };
}

/**
 * Stable card projection preserving registry order. Pricing references are
 * intentionally absent: a future pricing read model may join an opaque
 * reference without adding pricing rules to a tool configuration or DTO.
 */
export function projectAgentDefinitions(
  manifest: PublicToolManifest,
): readonly AgentDefinition[] {
  return manifest.tools.map(projectAgentDefinition);
}
