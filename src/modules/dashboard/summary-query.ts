import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "../../lib/i18n/locale.ts";
import type {
  DashboardCustomWindowResult,
  DashboardSummaryQueryInput,
  DashboardSummaryReadModel,
} from "./summary-contracts.ts";

/**
 * Browser-safe RPC for the compact dashboard summary read model (P1-T1-04).
 * The renderer receives only the pre-aggregated projection — never raw events.
 */
export const getDashboardSummaryReadModel = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DashboardSummaryReadModel> => {
    const { loadDashboardSummaryReadModel } =
      await import("./summary-api.server.ts");
    return loadDashboardSummaryReadModel(data);
  });

/** Custom date-range window projection (T1-05). */
export const getDashboardCustomWindow = createServerFn({ method: "GET" })
  .validator((value: DashboardSummaryQueryInput) => {
    if (typeof value?.locale !== "string")
      throw new TypeError("locale required");
    return {
      locale: value.locale,
      from: value.from,
      to: value.to,
      tool: value.tool ?? null,
    } satisfies DashboardSummaryQueryInput;
  })
  .handler(async ({ data }): Promise<DashboardCustomWindowResult> => {
    const { loadDashboardCustomWindow } =
      await import("./summary-api.server.ts");
    return loadDashboardCustomWindow(data);
  });

/** Light status probe for the first-scan empty state (≤ a few hundred bytes). */
export interface DashboardSnapshotStatus {
  readonly revision: string | null;
  readonly status: "empty" | "fresh" | "stale" | "failed" | "refreshing";
  readonly generatedAt: string | null;
}

/**
 * P4 (fix): the dashboard polls this tiny status probe while it shows the
 * first-scan empty state; when a revision lands the route loader re-runs so
 * real data replaces the shell without a manual reload. Reads only the Usage
 * snapshot coordinator (O(1)) — never a scan.
 */
export const getDashboardSnapshotStatus = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DashboardSnapshotStatus> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { usageSnapshot } = await getCompositionRoot();
    await usageSnapshot.ensureHydrated();
    const latest = usageSnapshot.readLatest();
    return {
      revision: latest.revision,
      status: latest.status,
      generatedAt: latest.generatedAt,
    };
  });
