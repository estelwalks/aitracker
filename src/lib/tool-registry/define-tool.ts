import type { ToolDefinition } from "./contracts.ts";

/**
 * Narrow a literal tool definition to `ToolDefinition` at compile time. Pure
 * identity at runtime - no validation side effects. Use `satisfies` semantics
 * so excess properties are rejected and capability discriminated unions are
 * checked. Runtime validation lives in `validate.ts`.
 *
 * @example
 * export default defineTool({
 *   id: "codex",
 *   configVersion: 1,
 *   display: { name: "Codex CLI", nameZh: "Codex CLI" },
 *   detection: { roots: [".codex"] },
 *   capabilities: { usage: { mode: "unsupported" }, ... },
 * });
 */
export function defineTool<T extends ToolDefinition>(def: T): T {
  return def;
}
