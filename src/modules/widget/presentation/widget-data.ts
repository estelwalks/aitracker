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
 * cross-renderer reads hit the same server-side projection.
 */

export interface WidgetToolStat {
  readonly id: string;
  readonly name: string;
  readonly tokens: number;
  readonly events: number;
  /** null 表示定价不可用（与 dashboard 的 estimatedCostUsd 语义一致）。 */
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
  /** 产出可用性（蒸馏输出 / 日报），null 表示该能力未提供数据。 */
  readonly outputs: {
    readonly distilled: number | null;
    readonly reports: number | null;
    /**
     * 知识库已批准的记忆资产数（approved/published），来自 knowledge 模块；
     * null 表示拉取失败或未提供数据（UI 显示「—」）。
     */
    readonly memory: number | null;
  };
  readonly security: SecurityScanOverview;
  /** 手动重新拉取（status + model + memory 失效）。 */
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

/** 知识库已批准（approved/published）的记忆资产数；拉取失败返回 null。 */
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
 * 小组件页统一数据源：紧凑 Widget 读模型（服务端预聚合四周期）+ 安全扫描概览。
 * 首次渲染看到 loading 初始态（与 SSR 保持一致）；status 为空（无快照）时
 * 保持空态，后台刷新完成后 status 的 revision 变化会自动触发 model 拉取。
 */
export function useWidgetData(): WidgetDataModel {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const security = useSecurityScanOverview();

  const cachedModel = readCachedWidgetReadModel(locale);
  const statusQuery = useQuery({
    queryKey: STATUS_KEY(locale),
    queryFn: () => getWidgetStatusReadModel({ data: locale }),
    // 可见时每 60 秒轮询；document 隐藏时 React Query 自动暂停
    // （refetchIntervalInBackground 默认 false）。
    refetchInterval: STATUS_INTERVAL_MS,
    staleTime: STATUS_INTERVAL_MS - 5_000,
    // P4-T4-06: 恢复可见时立即校验 revision（无论隐藏多久），保证
    // 回到窗口后 status/model 与后台刷新保持一致。
    refetchOnWindowFocus: "always",
  });
  const status = statusQuery.data;

  const modelQuery = useQuery({
    // The compact model is fetched immediately in parallel with the status
    // probe. The revision remains a validation signal, not a first-request
    // dependency, so the floating window never waits on status→model.
    queryKey: MODEL_KEY(locale, null),
    queryFn: () => getWidgetReadModel({ data: locale }),
    initialData: cachedModel,
    // A persisted compact model is valid until the tiny status probe reports
    // a different revision. With no cache, React Query still starts this
    // request immediately in parallel with status.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
  });

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
    if (modelQuery.data) writeCachedWidgetReadModel(locale, modelQuery.data);
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
 * 小组件整体状态：无数据=idle，有高风险=danger，有可疑=warn，否则 live。
 * 供浮窗状态点 / 菜单栏灵魂点 / 桌面情绪球共用。
 */
export function useWidgetMood(): WidgetMood {
  const { hasData, security } = useWidgetData();
  return resolveWidgetMood(hasData, security);
}
