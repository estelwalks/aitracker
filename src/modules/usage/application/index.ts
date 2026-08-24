/**
 * Usage application entry (module scaffold requirement).
 *
 * The usage feature's read path is the snapshot runtime
 * (`../infrastructure/usage-snapshot-runtime.server.ts`); this entry exposes
 * the pure tracker projection used by the Token burn leaderboard. No legacy
 * `UsageApplication` remains — the scheduler refreshes the unified Usage
 * snapshot coordinator directly (T2-07).
 */
export {
  aggregateBoards,
  buildBoard,
  computeMoM,
  suggestionFor,
  tokensForDimension,
  trackerTotalsFromEvents,
  wasteIndex,
  RECENT_TREND_DAYS,
} from "./tracker.ts";
export type {
  RoastDimension,
  RoastRow,
  RoastSuggestion,
  RoastTrend,
  TrackerBoard,
} from "./tracker.ts";
