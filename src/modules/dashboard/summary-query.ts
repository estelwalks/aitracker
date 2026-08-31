import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "../../lib/i18n/locale.ts";
import type {
  DashboardCustomWindowResult,
  DashboardSummaryQueryInput,
  DashboardSummaryReadModel,
} from "./summary-contracts.ts";
import {
  resolveDashboardSnapshotStatus,
  type DashboardSnapshotRefreshStatus,
} from "./snapshot-status.ts";

export type DashboardStandardWindowKey =
  keyof DashboardSummaryReadModel["windows"];

export interface DashboardToolWindowQueryInput {
  readonly locale: Locale;
  readonly period: DashboardStandardWindowKey;
  readonly tool: string;
}

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

/**
 * Standard period projection scoped to one tool. Keeping this on the same
 * server-composed read model preserves `all` semantics and avoids sending the
 * all-time sentinel through the bounded custom-range endpoint.
 */
export const getDashboardToolWindow = createServerFn({ method: "GET" })
  .validator((value: DashboardToolWindowQueryInput) => {
    if (typeof value?.locale !== "string")
      throw new TypeError("locale required");
    if (
      value.period !== "today" &&
      value.period !== "7d" &&
      value.period !== "30d" &&
      value.period !== "all"
    ) {
      throw new TypeError("standard dashboard period required");
    }
    if (typeof value.tool !== "string" || value.tool.length === 0)
      throw new TypeError("tool required");
    return value;
  })
  .handler(async ({ data }): Promise<DashboardCustomWindowResult> => {
    const { loadDashboardSummaryReadModel } =
      await import("./summary-api.server.ts");
    const summary = await loadDashboardSummaryReadModel(
      data.locale,
      undefined,
      data.tool,
    );
    return {
      meta: summary.meta,
      window: summary.windows[data.period],
    };
  });

/** Light status probe for the first-scan/stale state (≤ a few hundred bytes). */
export interface DashboardSnapshotStatus {
  readonly revision: string | null;
  readonly status: DashboardSnapshotRefreshStatus;
  readonly generatedAt: string | null;
}

/**
 * P4 (fix): the dashboard polls this tiny status probe while it shows the
 * first-scan empty or stale state; when either the usage or session revision
 * changes the route loader re-runs so real data replaces the shell without a
 * manual reload. Reads only snapshot coordinators (O(1)) — never a scan.
 */
export const getDashboardSnapshotStatus = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DashboardSnapshotStatus> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { usageSnapshot, sessionSnapshot } = await getCompositionRoot();
    await Promise.all([
      usageSnapshot.ensureHydrated(),
      sessionSnapshot.ensureHydrated(),
    ]);
    const latest = usageSnapshot.readLatest();
    const sessions = sessionSnapshot.readLatest();
    const status = resolveDashboardSnapshotStatus({
      usage: latest,
      sessions,
    });
    return {
      // The usage revision remains the legacy field; a session-only refresh
      // is represented by the combined status and causes the loader to run.
      revision: latest.revision ?? sessions.revision,
      status,
      generatedAt: latest.generatedAt ?? sessions.generatedAt,
    };
  });

/** Explicit user retry for a failed first scan; it never reads local data inline. */
export const retryDashboardSnapshotInitialization = createServerFn({
  method: "POST",
})
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<void> => {
    void data;
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { usageSnapshot, sessionSnapshot } = await getCompositionRoot();
    await Promise.all([
      usageSnapshot.requestRefresh({ reason: "manual" }),
      sessionSnapshot.requestRefresh({ reason: "manual" }),
    ]);
  });
