import type { DashboardV2Tool } from "../contracts.ts";

export type DashboardToolWithUsage = DashboardV2Tool & {
  readonly tokens: number;
  readonly events: number;
};

/**
 * A tool is eligible for the rail only when the active window observed token
 * usage for it. The selected tool is not treated as an exception here: the
 * page resolves an invalid selection to `all` before rendering the rail.
 */
export function resolveDashboardSelectedTool(
  selectedTool: string,
  tools: readonly DashboardToolWithUsage[],
): string {
  if (selectedTool === "all") return selectedTool;
  return tools.some((tool) => tool.id === selectedTool && tool.tokens > 0)
    ? selectedTool
    : "all";
}

/**
 * Keep the tool rail on the unscoped usage order while a tool is selected.
 * The selected view is allowed to change its metrics, but must not change the
 * position of the buttons in the overview rail.
 */
export function resolveDashboardToolRailTools(
  selectedTool: string,
  currentTools: readonly DashboardToolWithUsage[],
  unscopedTools: readonly DashboardToolWithUsage[],
): readonly DashboardToolWithUsage[] {
  const orderedTools = selectedTool === "all" ? currentTools : unscopedTools;
  return orderedTools.filter((tool) => tool.tokens > 0);
}
