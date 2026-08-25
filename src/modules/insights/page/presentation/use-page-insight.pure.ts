/**
 * Pure, UI-free helpers for the page-insight double-mode hook. Kept in a
 * separate module (no React, no server-fn imports) so they can be tested with
 * node:test in isolation and shared by any presentational wrapper.
 */
import { isInsightAnalysisUseful } from "../analysis-quality.ts";

/** Renderer event emitted after the active model profile changes. */
export const PAGE_INSIGHT_REFRESH_EVENT = "trusttools:page-insight-refresh";

/**
 * Severity of a single envelope line. Matches the frozen M1 contract
 * (`InsightSeverity`) without importing it, so this module stays decoupled.
 */
export type InsightSeverity = "info" | "attention" | "risk";

/** Site-local actions an insight line can link to (M1 action registry). */
export type InsightActionId =
  | "open_security"
  | "open_distill"
  | "open_reports"
  | "open_sessions"
  | "open_sources"
  | "open_settings"
  | "open_tracker"
  | "open_market"
  | "open_skills"
  | "open_memory";

/** Envelope lifecycle status (M1 `InsightEnvelopeStatus`). */
export type InsightEnvelopeStatus =
  | "rules"
  | "enhanced-cached"
  | "enhanced-ready"
  | "enhancer-unavailable"
  | "budget-exceeded"
  | "timeout"
  | "enhancer-failed"
  | "invalid-output"
  | "stale";

/** Known in-app route path for each action id (typed for `<Link to={...}>`). */
export type InsightActionPath =
  | "/security"
  | "/distill"
  | "/reports"
  | "/chats"
  | "/sources"
  | "/settings"
  | "/tracker"
  | "/market"
  | "/skills"
  | "/memory";

/** Minimum gap between two manual enhance calls (anti double-click). */
export const ENHANCE_COOLDOWN_MS = 60_000;

const STATUS_LABEL_KEYS: Record<InsightEnvelopeStatus, string> = {
  rules: "settings.insight.status.rules",
  "enhanced-cached": "settings.insight.status.enhanced-cached",
  "enhanced-ready": "settings.insight.status.enhanced-ready",
  "enhancer-unavailable": "settings.insight.status.enhancer-unavailable",
  "budget-exceeded": "settings.insight.status.budget-exceeded",
  timeout: "settings.insight.status.timeout",
  "enhancer-failed": "settings.insight.status.enhancer-failed",
  "invalid-output": "settings.insight.status.invalid-output",
  stale: "settings.insight.status.stale",
};

/** Map an envelope status to its i18n message key (`settings.insight.status.*`). */
export function insightStatusLabel(status: InsightEnvelopeStatus): string {
  return STATUS_LABEL_KEYS[status];
}

const FALLBACK_STATUS_LABEL_KEYS: Partial<
  Record<InsightEnvelopeStatus, string>
> = {
  "enhancer-unavailable":
    "settings.insight.fallbackStatus.enhancer-unavailable",
  "budget-exceeded": "settings.insight.fallbackStatus.budget-exceeded",
  timeout: "settings.insight.fallbackStatus.timeout",
  "enhancer-failed": "settings.insight.fallbackStatus.enhancer-failed",
  "invalid-output": "settings.insight.fallbackStatus.invalid-output",
};

/** Localized, renderer-safe explanation when AI enhancement fell back to rules. */
export function insightFallbackStatusLabel(
  status: InsightEnvelopeStatus,
): string | null {
  return FALLBACK_STATUS_LABEL_KEYS[status] ?? null;
}

const ACTION_PATHS: Record<InsightActionId, InsightActionPath> = {
  open_security: "/security",
  open_distill: "/distill",
  open_reports: "/reports",
  open_sessions: "/chats",
  open_sources: "/sources",
  open_settings: "/settings",
  open_tracker: "/tracker",
  open_market: "/market",
  open_skills: "/skills",
  open_memory: "/memory",
};

/** Map an action id to its in-app route path (M1 action registry). */
export function insightActionPath(
  actionId: InsightActionId,
): InsightActionPath {
  return ACTION_PATHS[actionId];
}

/** Loose `t` signature: any typed message resolver is assignable to this. */
export type ComposeTranslate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/** Structural subset of an envelope line needed to compose display text. */
export interface ComposableInsightLine {
  readonly key: string;
  readonly params?: Readonly<Record<string, string | number>>;
  readonly analysis?: string;
}

/**
 * Compose a single localized line: `t(key, params)`, optionally followed by
 * the model-provided `analysis` sentence (`。` + analysis). The action label is
 * resolved separately by the hook so the component can render it as a button.
 */
export function composeLineText(
  t: ComposeTranslate,
  line: ComposableInsightLine,
): string {
  const base = t(line.key, line.params);
  if (!isInsightAnalysisUseful(base, line.analysis)) return base;
  if (/[。！？…]$/u.test(base)) return `${base}${line.analysis}`;
  if (/[.!?]$/u.test(base)) return `${base} ${line.analysis}`;
  return `${base}。${line.analysis}`;
}

/** Whether a manual enhance is allowed given the last successful attempt time. */
export function canEnhanceNow(
  lastAt: number | null | undefined,
  now: number,
): boolean {
  return lastAt == null || now - lastAt >= ENHANCE_COOLDOWN_MS;
}
