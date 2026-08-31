import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useI18n } from "../../../lib/i18n/context";
import type { Locale } from "../../../lib/i18n/locale";
import {
  getWidgetReadModel,
  getWidgetStatusReadModel,
  type WidgetPeriodStats,
  type WidgetReadModel,
} from "../read-model";
import { getMemoryAssets } from "../../knowledge";
import {
  useSecurityScanOverview,
  type SecurityScanOverview,
} from "../../security-assessment";
import {
  readCachedWidgetReadModel,
  writeCachedWidgetReadModel,
} from "../read-model-cache";

/**
 * P4-T4-06: Widget revision protocol (Query-owned).
 *
 * The widget polls a ≤2 KB status probe every 60s via React Query
 * (refetchInterval pauses automatically while the document is hidden) and
 * only fetches the ≤50 KB pre-aggregated model when the snapshot revision
 * changes — the model query key embeds the revision. No raw events ever cross
 * this boundary and no client-side re-aggregation happens. Query caching
 * deduplicates the read model across widget previews within one renderer;
 * cross-renderer reads hit the same server-side projection and SQLite-backed
 * preference cache.
 */

export interface WidgetToolStat {
  readonly id: string;
  readonly name: string;
  readonly tokens: number;
  readonly events: number;
  /** null means pricing is not available (same semantics as dashboard's estimatedCostUsd). */
  readonly costUsd: number | null;
}

export interface WidgetDataModel {
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasData: boolean;
  readonly generatedAt: string | null;
  readonly today: WidgetPeriodStats;
  readonly week: WidgetPeriodStats;
  readonly month: WidgetPeriodStats;
  readonly total: WidgetPeriodStats;
  /** Output availability (distillation output/daily), null means no data is provided for this capability. */
  readonly outputs: {
    readonly distilled: number | null;
    readonly reports: number | null;
    /**
     * The number of memory assets approved by the knowledge base (approved/published), from the knowledge module;
     * null means that the pull failed or no data was provided (the UI displays "—").
     */
    readonly memory: number | null;
  };
  readonly security: SecurityScanOverview;
  /** Manually re-pull (status + model + memory invalid). */
  readonly refresh: () => void;
}

export type WidgetMood = "idle" | "live" | "warn" | "danger";

export function resolveWidgetMood(
  hasData: boolean,
  security: SecurityScanOverview,
): WidgetMood {
  if (security.loading) return "idle";
  const danger = security.summary?.dangerousCount ?? 0;
  if (danger > 0) return "danger";
  if ((security.summary?.suspiciousCount ?? 0) > 0) return "warn";
  return hasData ? "live" : "idle";
}

const STATUS_INTERVAL_MS = 60_000;

const emptyPeriod = (): WidgetPeriodStats => ({
  tokens: 0,
  events: 0,
  sessions: null,
  activeTools: 0,
  costUsd: null,
  cacheRate: null,
  trend: [],
  topTools: [],
});

/** The number of memory assets that have been approved/published by the knowledge base; null is returned if the pull fails. */
function countApprovedMemories(entries: readonly { status: string }[]): number {
  return entries.filter(
    (entry) => entry.status === "approved" || entry.status === "published",
  ).length;
}

const STATUS_KEY = (locale: Locale) => ["widget-status", locale] as const;
const MODEL_KEY = (locale: Locale, revision: string | null) =>
  ["widget-model", locale, revision ?? null] as const;
const MEMORY_KEY = ["widget-memory"] as const;

/**
 * Unified data source for widget pages: compact widget reading model (four cycles of server-side pre-aggregation) + security scanning overview.
 * When rendering for the first time, you will see the loading initial state (consistent with SSR); when status is empty (no snapshot)
 * Keep it empty. After the background refresh is completed, the revision change of status will automatically trigger the model pull.
 */
export function useWidgetData(): WidgetDataModel {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const security = useSecurityScanOverview();

  const statusQuery = useQuery({
    queryKey: STATUS_KEY(locale),
    queryFn: () => getWidgetStatusReadModel({ data: locale }),
    // Poll every 60 seconds when visible; React Query automatically pauses when the document is hidden
    // (refetchIntervalInBackground defaults to false).
    refetchInterval: STATUS_INTERVAL_MS,
    staleTime: STATUS_INTERVAL_MS - 5_000,
    // P4-T4-06: Verify revision immediately when visible again (no matter how long it is hidden), guaranteed
    // After returning to the window, status/model remains consistent with background refresh.
    refetchOnWindowFocus: "always",
  });
  const status = statusQuery.data;

  const modelQuery = useQuery({
    // The compact model is fetched immediately in parallel with the status
    // probe. The revision remains a validation signal, not a first-request
    // dependency, so the floating window never waits on status→model.
    queryKey: MODEL_KEY(locale, null),
    queryFn: () => getWidgetReadModel({ data: locale }),
    // A persisted compact model is hydrated below and remains valid until the
    // tiny status probe reports a different revision. Without a cache, React
    // Query starts this request immediately in parallel with status.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
  });

  useEffect(() => {
    let active = true;
    void readCachedWidgetReadModel(locale).then((cached) => {
      if (!active || cached == null) return;
      queryClient.setQueryData<WidgetReadModel | undefined>(
        MODEL_KEY(locale, null),
        (current) => current ?? cached,
      );
    });
    return () => {
      active = false;
    };
  }, [locale, queryClient]);

  useEffect(() => {
    const revision = status?.revision;
    const modelRevision = modelQuery.data?.revision;
    if (
      revision != null &&
      modelRevision != null &&
      revision !== modelRevision
    ) {
      void queryClient.invalidateQueries({ queryKey: MODEL_KEY(locale, null) });
    }
  }, [locale, modelQuery.data?.revision, queryClient, status?.revision]);

  useEffect(() => {
    if (modelQuery.data)
      void writeCachedWidgetReadModel(locale, modelQuery.data);
  }, [locale, modelQuery.data]);

  const memoryQuery = useQuery({
    queryKey: MEMORY_KEY,
    queryFn: () => getMemoryAssets(),
    staleTime: 5 * 60_000,
  });

  const model: WidgetReadModel | undefined = modelQuery.data;

  const view = useMemo(() => {
    if (model == null) {
      return {
        hasData: false,
        generatedAt: null,
        today: emptyPeriod(),
        week: emptyPeriod(),
        month: emptyPeriod(),
        total: emptyPeriod(),
        outputs: { distilled: null, reports: null, memory: null },
      };
    }
    return {
      hasData: model.hasData,
      generatedAt: model.generatedAt,
      today: model.today,
      week: model.week,
      month: model.month,
      total: model.total,
      outputs: {
        distilled: model.outputs.distilled,
        reports: model.outputs.reports,
        memory:
          memoryQuery.data == null
            ? null
            : countApprovedMemories(memoryQuery.data.entries),
      },
    };
  }, [model, memoryQuery.data]);

  // Security and memory are secondary cards. Token totals/trends can render
  // from the compact model while those independent queries are still pending.
  const loading = modelQuery.isPending && model == null;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["widget-status"] });
    void queryClient.invalidateQueries({ queryKey: ["widget-model"] });
    void queryClient.invalidateQueries({ queryKey: ["widget-memory"] });
  };

  return {
    loading,
    error:
      modelQuery.isError || (statusQuery.isError && modelQuery.data == null)
        ? t("widget.loadFailed")
        : null,
    security,
    refresh,
    ...view,
  };
}

/**
 * The overall status of the widget: no data=idle, high risk=danger, suspicious=warn, otherwise live.
 * Shared by floating window status points/menu bar soul points/desktop mood balls.
 */
export function useWidgetMood(): WidgetMood {
  const { hasData, security } = useWidgetData();
  return resolveWidgetMood(hasData, security);
}
