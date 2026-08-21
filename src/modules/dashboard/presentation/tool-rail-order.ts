import type { DashboardV2Tool } from "../contracts.ts";

export type DashboardToolWithUsage = DashboardV2Tool & {
  readonly tokens: number;
  readonly events: number;
};

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
  return selectedTool === "all" ? currentTools : unscopedTools;
}
