import type { DashboardV2Tool } from "../contracts.ts";

export type DashboardToolWithUsage = DashboardV2Tool & {
  readonly tokens: number;
  readonly events: number;
  readonly sessionCount?: number;
};

/**
 * A tool is eligible for the rail when the active window has usage tokens,
 * usage events, or sessions for it. Installation/detection alone is not
 * activity.
 */
export function resolveDashboardSelectedTool(
  selectedTool: string,
  tools: readonly DashboardToolWithUsage[],
): string {
  if (selectedTool === "all") return selectedTool;
  return tools.some(
    (tool) =>
      tool.id === selectedTool &&
      (tool.tokens > 0 || tool.events > 0 || (tool.sessionCount ?? 0) > 0),
  )
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
  return orderedTools.filter(
    (tool) =>
      tool.tokens > 0 || tool.events > 0 || (tool.sessionCount ?? 0) > 0,
  );
}
