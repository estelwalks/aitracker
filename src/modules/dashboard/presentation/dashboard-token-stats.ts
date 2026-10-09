import type { DashboardV2View } from "../contracts.ts";

/** Token statistics are unavailable when the selected source exposes only
 * session/activity metadata, such as Doubao Work subscription records. */
export function hasTokenStats(view: DashboardV2View): boolean {
  return (
    view.tools.length === 0 ||
    view.tools.some((tool) => tool.usageSupport !== "unsupported")
  );
}
