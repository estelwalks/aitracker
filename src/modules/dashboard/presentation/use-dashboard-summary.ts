import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Locale } from "../../../lib/i18n/locale.ts";
import {
  getDashboardSnapshotStatus,
  getDashboardSummaryReadModel,
  retryDashboardSnapshotInitialization,
} from "../summary-query.ts";
import type { DashboardSnapshotStatus } from "../summary-query.ts";
import {
  dashboardSnapshotSignature,
  shouldRefreshDashboardSummary,
} from "./dashboard-sync-policy.ts";

const FIRST_SCAN_POLL_MS = 2_000;
const BACKGROUND_REFRESH_POLL_MS = 15_000;

function snapshotPollInterval(
  status?: DashboardSnapshotStatus,
): number | false {
  if (status?.status === "failed") return false;
  return status == null ||
    status.status === "empty" ||
    status.status === "refreshing" ||
    status.status === "stale"
    ? FIRST_SCAN_POLL_MS
    : BACKGROUND_REFRESH_POLL_MS;
}

/**
 * Client-only Dashboard owner. SSR and the first hydration pass both render
 * the same skeleton; the expensive read model starts after the app shell has
 * committed and remains isolated from router navigation state.
 */
export function useDashboardSummary(locale: Locale) {
  const queryClient = useQueryClient();
  const [clientReady, setClientReady] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const navigationPending = useRouterState({
    select: (state) => state.status === "pending",
  });
  const lastHandledStatus = useRef<string | null>(null);

  useEffect(() => setClientReady(true), []);
  useEffect(() => {
    lastHandledStatus.current = null;
  }, [locale]);

  const summaryQuery = useQuery({
    queryKey: ["dashboard-summary", locale],
    queryFn: ({ signal }) =>
      getDashboardSummaryReadModel({ data: locale, signal }),
    enabled: clientReady && !navigationPending,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const {
    data: summary,
    error,
    isFetching: summaryFetching,
    isPending: summaryPending,
    refetch: refetchSummary,
  } = summaryQuery;

  // Consume the query AbortSignal and cancel the browser request as soon as a
  // sidebar navigation starts. The route transition never waits for the
  // Dashboard response, even if its result is no longer needed.
  useEffect(() => {
    if (!navigationPending) return;
    void queryClient.cancelQueries({
      queryKey: ["dashboard-summary", locale],
      exact: true,
    });
  }, [locale, navigationPending, queryClient]);

  // This is the only Dashboard polling loop. React Query guarantees one
  // in-flight probe per key, and the probe pauses while any route navigation
  // is pending or while the heavier summary request is active.
  const statusQuery = useQuery({
    queryKey: ["dashboard-snapshot-status", locale],
    queryFn: ({ signal }) =>
      getDashboardSnapshotStatus({ data: locale, signal }),
    enabled:
      clientReady && summary != null && !navigationPending && !summaryFetching,
    staleTime: 1_000,
    retry: false,
    refetchInterval: (query) => snapshotPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
  });
  const { data: snapshotStatus, refetch: refetchStatus } = statusQuery;
  const sessionsAvailable =
    summary != null && summary.windows["30d"].sessions != null;

  useEffect(() => {
    if (snapshotStatus == null) return;
    if (
      !shouldRefreshDashboardSummary({
        navigationPending,
        summaryFetching,
        summaryRevision: summary?.revision ?? null,
        sessionsAvailable,
        status: snapshotStatus,
      })
    ) {
      return;
    }

    const signature = dashboardSnapshotSignature(snapshotStatus);
    if (lastHandledStatus.current === signature) return;
    lastHandledStatus.current = signature;
    void refetchSummary({ cancelRefetch: false });
  }, [
    navigationPending,
    refetchSummary,
    sessionsAvailable,
    snapshotStatus,
    summary?.revision,
    summaryFetching,
  ]);

  const retryInitialization = useCallback(async (): Promise<void> => {
    setRetrying(true);
    lastHandledStatus.current = null;
    try {
      await retryDashboardSnapshotInitialization({ data: locale });
      await Promise.all([
        refetchSummary({ cancelRefetch: false }),
        refetchStatus({ cancelRefetch: false }),
      ]);
    } finally {
      setRetrying(false);
    }
  }, [locale, refetchStatus, refetchSummary]);

  return {
    data: summary,
    error,
    loading: !clientReady || summaryPending,
    fetching: summaryFetching,
    snapshotStatus: retrying
      ? ("refreshing" as const)
      : (snapshotStatus?.status ?? "empty"),
    retry: retryInitialization,
  };
}
