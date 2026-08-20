import type { MessageKey } from "../../../lib/i18n/schema.ts";
import type { InsightActionId } from "./contracts.ts";

/**
 * The single registry mapping every insight action to its localized label and
 * navigation target. Adaptors may only propose actions that exist here.
 */
export const INSIGHT_ACTIONS: Record<
  InsightActionId,
  { labelKey: MessageKey; path: string }
> = {
  open_security: { labelKey: "insights.actions.security", path: "/security" },
  open_distill: { labelKey: "insights.actions.distill", path: "/distill" },
  open_reports: { labelKey: "insights.actions.reports", path: "/reports" },
  open_sessions: { labelKey: "insights.actions.sessions", path: "/chats" },
  open_sources: { labelKey: "insights.actions.sources", path: "/sources" },
  open_settings: { labelKey: "insights.actions.settings", path: "/settings" },
  open_tracker: { labelKey: "insights.actions.tracker", path: "/tracker" },
  open_market: { labelKey: "insights.actions.market", path: "/market" },
  open_skills: { labelKey: "insights.actions.skills", path: "/skills" },
  open_memory: { labelKey: "insights.actions.memory", path: "/memory" },
};

export function isInsightActionId(value: unknown): value is InsightActionId {
  return typeof value === "string" && value in INSIGHT_ACTIONS;
}
