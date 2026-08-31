/**
 * Token-usage export row shape (FR-032).
 *
 * This is a self-contained, framework-free view of a single usage record. It
 * mirrors the relevant subset of {@link LocalUsageEvent} but omits the
 * pricing-coupled fields (cost is computed separately by `src/lib/pricing/`
 * and is therefore passed in here as an optional per-row value, keeping the
 * export module decoupled from pricing). Field order on this interface is
 * informational only — the on-disk column order is owned by `csv.ts`.
 */
export interface ExportRow {
  /** ISO 8601 timestamp (e.g. `2026-07-27T10:00:00.000Z`). */
  timestamp: string;
  /** Stable source id (e.g. `claude-code`); mapped to a display label at export time. */
  source: string;
  /** Raw model identifier as reported by the tool. */
  model: string;
  /** Optional project path (already `$HOME`-normalized to `~/`). Empty when unknown. */
  project?: string;
  /** Prompt input tokens. */
  inputTokens: number;
  /** Completion output tokens. */
  outputTokens: number;
  /** Cached prompt-read tokens. */
  cachedInputTokens: number;
  /** Cache-creation (write) tokens. */
  cacheCreationInputTokens: number;
  /** Reasoning tokens. */
  reasoningOutputTokens: number;
  /** Optional cost for this row (any currency); omitted when pricing is unknown. */
  cost?: number;
  /** Cost converted to the display currency (docs/plan v1.2 export). */
  costDisplay?: number;
  /** Display currency code (machine-readable stable value). */
  currency?: string;
  /** USD → display-currency rate used for `costDisplay`. */
  rate?: number;
  /** Rate date (ISO `YYYY-MM-DD`) from the shared rates snapshot. */
  rateDate?: string;
}
