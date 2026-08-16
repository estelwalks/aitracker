import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { useI18n } from "../../../lib/i18n/context";
import type { Locale } from "../../../lib/i18n/locale";
import type { UsagePeriod } from "../../../lib/local-usage/presentation";
import { resolveUsageRange } from "../../../lib/local-usage/presentation";
import type { LocalUsageEvent } from "../../../lib/local-usage/types";
import { estimateUsageCost } from "../../../lib/pricing";
import { createDashboardV2View } from "../../dashboard/application/v2";
import type {
  DashboardReadModel,
  DashboardV2Event,
  DashboardV2Snapshot,
} from "../../dashboard/contracts";
import { getDashboardReadModel } from "../../dashboard/query";
import {
  useSecurityScanOverview,
  type SecurityScanOverview,
} from "../../security-assessment/query/use-security-scan-overview";

/** 与 dashboard 的 30s router.invalidate 节奏一致。 */
const REFRESH_INTERVAL_MS = 30_000;

export interface WidgetToolStat {
  readonly id: string;
  readonly name: string;
  readonly tokens: number;
  readonly events: number;
  /** null 表示定价不可用（与 dashboard 的 estimatedCostUsd 语义一致）。 */
  readonly costUsd: number | null;
}

export interface WidgetPeriodStats {
  readonly tokens: number;
  readonly events: number;
  readonly sessions: number | null;
  readonly activeTools: number;
  readonly costUsd: number | null;
  readonly cacheRate: number | null;
  readonly trend: readonly { date: string; tokens: number }[];
  readonly topTools: readonly WidgetToolStat[];
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
  };
  readonly security: SecurityScanOverview;
  /** 手动重新拉取 dashboard 读模型。 */
  readonly refresh: () => void;
}

export type WidgetMood = "idle" | "live" | "warn" | "danger";

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

/** DashboardV2Event → 定价层需要的 LocalUsageEvent 投影（只取计费字段）。 */
function toLocalUsageEvent(event: DashboardV2Event): LocalUsageEvent {
  return {
    source: event.source,
    timestamp: event.timestamp,
    model: event.model,
    project: event.project,
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
  };
}

function eventsInRange(
  events: readonly DashboardV2Event[],
  from: Date,
  to: Date,
): DashboardV2Event[] {
  return events.filter((event) => {
    const timestamp = new Date(event.timestamp);
    if (Number.isNaN(timestamp.getTime())) return false;
    return timestamp >= from && timestamp <= to;
  });
}

function buildPeriod(
  snapshot: DashboardV2Snapshot,
  period: UsagePeriod,
  withTrend = period === "today" || period === "7d",
): WidgetPeriodStats {
  const view = createDashboardV2View(snapshot, period);
  const range = resolveUsageRange(period);
  const rangeEvents =
    range.fromDate != null && range.toDate != null
      ? eventsInRange(snapshot.events, range.fromDate, range.toDate)
      : [];

  const toolNames = new Map(view.tools.map((tool) => [tool.id, tool.name]));
  const groups = new Map<string, DashboardV2Event[]>();
  for (const event of rangeEvents) {
    const group = groups.get(event.source) ?? [];
    group.push(event);
    groups.set(event.source, group);
  }
  const topTools: WidgetToolStat[] = [...groups.entries()]
    .map(([id, events]) => {
      const tokens = events.reduce((sum, event) => sum + event.totalTokens, 0);
      const cost = snapshot.pricingAvailable
        ? estimateUsageCost(events.map(toLocalUsageEvent))
        : null;
      return {
        id,
        name: toolNames.get(id) ?? id,
        tokens,
        events: events.length,
        costUsd: cost == null ? null : cost.knownUsd + cost.estimatedUsd,
      };
    })
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 5);

  return {
    tokens: view.totals.totalTokens,
    events: view.totals.events,
    sessions: view.sessions,
    activeTools: view.activeTools,
    costUsd: view.estimatedCostUsd,
    cacheRate: view.cacheRate,
    trend: withTrend
      ? view.trend.map((point) => ({
          date: point.date,
          tokens: point.tokens,
        }))
      : [],
    topTools,
  };
}

interface SharedReadModel {
  readonly data: DashboardReadModel | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly locale: Locale;
}

const initialShared: SharedReadModel = {
  data: null,
  loading: true,
  failed: false,
  locale: "zh-CN",
};

/**
 * 多个小组件（浮窗/托盘/桌面/菜单栏）共享同一份 dashboard 读模型：
 * 模块级 store + useSyncExternalStore，首次订阅即拉取，30s 轮询去重，
 * 避免每个预览实例各自重复请求。
 */
let shared: SharedReadModel = initialShared;
const listeners = new Set<() => void>();
let busy = false;

function emitShared(): void {
  for (const listener of listeners) listener();
}

function subscribeShared(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function loadShared(locale: Locale): void {
  if (busy) return;
  busy = true;
  void getDashboardReadModel({ data: locale })
    .then((next) => {
      shared = { data: next, loading: false, failed: false, locale };
    })
    .catch(() => {
      shared = { ...shared, loading: false, failed: true };
    })
    .finally(() => {
      busy = false;
      emitShared();
    });
}

/**
 * 小组件页统一数据源：dashboard 读模型（含会话/定价/产出可用性）+ 安全扫描概览。
 *
 * 仅客户端拉取（首次订阅在 useEffect 中触发），SSR/首帧渲染看到 loading
 * 初始态，避免水合不一致；所有值来自真实数据，无 mock 回退。
 */
export function useWidgetData(): WidgetDataModel {
  const { locale, t } = useI18n();
  const security = useSecurityScanOverview();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (shared.locale !== locale || shared.data == null) {
      loadShared(locale);
    }
    const timer = window.setInterval(
      () => loadShared(locale),
      REFRESH_INTERVAL_MS,
    );
    return () => window.clearInterval(timer);
  }, [locale, refreshKey]);

  const sharedModel = useSyncExternalStore(
    subscribeShared,
    () => shared,
    () => initialShared,
  );

  const model = useMemo(() => {
    const readModel = sharedModel.data;
    if (readModel == null) {
      return {
        hasData: false,
        generatedAt: null,
        today: emptyPeriod(),
        week: emptyPeriod(),
        month: emptyPeriod(),
        total: emptyPeriod(),
        outputs: { distilled: null, reports: null },
      };
    }
    return {
      hasData: readModel.v2.events.length > 0,
      generatedAt: readModel.v2.generatedAt,
      today: buildPeriod(readModel.v2, "today"),
      week: buildPeriod(readModel.v2, "7d"),
      month: buildPeriod(readModel.v2, "30d"),
      total: buildPeriod(readModel.v2, "all"),
      outputs: {
        distilled: readModel.v2.outputAvailability.distillationOutputs.count,
        reports: readModel.v2.outputAvailability.dailyReports.count,
      },
    };
  }, [sharedModel]);

  return {
    loading: sharedModel.loading,
    error: sharedModel.failed ? t("widget.loadFailed") : null,
    refresh: () => setRefreshKey((key) => key + 1),
    security,
    ...model,
  };
}

/**
 * 小组件整体状态：无数据=idle，有高风险=danger，有可疑=warn，否则 live。
 * 供浮窗状态点 / 菜单栏灵魂点 / 桌面情绪球共用。
 */
export function useWidgetMood(): WidgetMood {
  const { hasData, security } = useWidgetData();
  if (security.loading) return "idle";
  const danger = security.summary?.dangerousCount ?? 0;
  if (danger > 0) return "danger";
  if ((security.summary?.suspiciousCount ?? 0) > 0) return "warn";
  return hasData ? "live" : "idle";
}
