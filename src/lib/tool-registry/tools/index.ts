/**
 * Static tool-definition whitelist. Every built-in tool config is imported here
 * explicitly - never scan the directory or dynamic-import based on user input.
 *
 * M1 placeholder: empty. M2 populates this with the 27 `*.config.ts` imports.
 */
import type { ToolDefinition } from "../contracts.ts";

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [];
