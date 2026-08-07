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

/** Inputs accepted by the dashboard query. Infrastructure stays behind the API adapter. */
export interface DashboardQuery {
  readonly locale: Locale;
  readonly snapshot: LocalUsageSnapshot;
  readonly pricing: PricingSnapshot | null;
  readonly skills: { readonly skills: readonly unknown[] } | null;
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
