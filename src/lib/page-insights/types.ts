import type { MessageKey } from "../i18n/messages";

/**
 * Pages that can surface a Jarvis insight card. `distill` / `reports` /
 * `skills` are reserved for other tasks; only `sources` and `tracker` produce
 * real lines today.
 */
export const PAGE_INSIGHTS_IDS = [
  "sources",
  "tracker",
  "distill",
  "reports",
  "skills",
] as const;

export type PageInsightsPage = (typeof PAGE_INSIGHTS_IDS)[number];

/**
 * A structured insight line. The renderer (browser) resolves `key`/`params`
 * through the typed i18n layer, so server-side logic stays language-neutral
 * and the numbers always come from real read models — never hardcoded.
 */
export interface PageInsight {
  /** Stable id for the carousel key (not user-facing). */
  readonly id: string;
  /** i18n message key under the `insights.*` dictionary namespace. */
  readonly key: MessageKey;
  /** Interpolation params; values are already locale-formatted strings. */
  readonly params?: Record<string, string | number>;
}

export interface PageInsightsResult {
  readonly generatedAt: string;
  readonly page: PageInsightsPage;
  readonly lines: readonly PageInsight[];
}
