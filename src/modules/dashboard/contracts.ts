export const dashboardModuleId = "dashboard" as const;
export type DashboardModuleId = typeof dashboardModuleId;
export interface DashboardModuleContract {
  readonly module: DashboardModuleId;
  readonly schemaVersion: 1;
}

import type {
  LocalUsageEvent,
  LocalUsageSnapshot,
} from "../../lib/local-usage/types.ts";
import type { LocalUsageTotals } from "../../lib/local-usage/types.ts";
import type { CostEstimate, PricingSnapshot } from "../../lib/pricing";
import type { Locale } from "../../lib/i18n/locale";
import type { SkillSnapshot } from "../../lib/local-skills/types";

/** Inputs accepted by the dashboard query. Infrastructure stays behind the API adapter. */
export interface DashboardQuery {
  readonly locale: Locale;
  readonly snapshot: LocalUsageSnapshot;
  readonly pricing: PricingSnapshot | null;
  /**
   * The scanner result is already a plain-data DTO (no class instances,
   * functions, or opaque values), so it can safely cross the ServerFn
   * boundary. Keep the concrete type here instead of `unknown[]`; TanStack's
   * serializability validator must be able to inspect every nested field.
   */
  readonly skills: SkillSnapshot | null;
  readonly error: string | null;
  /** Privacy-safe aggregates; raw project refs/insight evidence never cross the route boundary. */
  readonly projectCount?: number;
  readonly activeInsightCount?: number;
}

/** Server loader result shared by the route and desktop adapters. */
export type DashboardReadModel = DashboardQuery;

export interface DashboardSelection {
  readonly events: readonly LocalUsageEvent[];
  readonly totals: LocalUsageTotals;
  readonly cost: CostEstimate;
}
