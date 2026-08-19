import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ChunkErrorBoundary } from "../../../components/ChunkErrorBoundary";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import { resolveUsageRange } from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardSummaryReadModel,
  DashboardWindowSummary,
} from "../summary-contracts.ts";
import { windowToView } from "../summary-contracts.ts";
import {
  getDashboardCustomWindow,
  getDashboardSnapshotStatus,
} from "../summary-query.ts";
import {
  DashboardAgentWorkstreams,
  DashboardContribHeatmap,
  DashboardJarvisInsight,
  DashboardMetricGrid,
  DashboardModelDonut,
  DashboardProjectOverview,
  DashboardRangePicker,
  DashboardToolSwitcher,
  DashboardTrustHero,
} from "./dashboard-v2-sections.tsx";

// P6-T6-05: Recharts trend panel is loaded on demand (not in the initial
// shared shell). The Suspense fallback keeps layout stable during load.
const DashboardTrendPanel = lazy(() =>
  import("./dashboard-trend-panel.tsx").then((module) => ({
    default: module.DashboardTrendPanel,
  })),
);

/** Poll interval while the dashboard shows the first-scan empty state. */
const EMPTY_REFRESH_POLL_MS = 15_000;

function localDateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * The route only coordinates period/tool selections. All window aggregates are
 * pre-computed on the server (P1-T1-04); the renderer combines the selected
 * window with the shared tool cards / calendar — it never re-aggregates raw
 * events.
 */
export function DashboardV2Page({ data }: { data: DashboardSummaryReadModel }) {
  const { format, t } = useI18n();
  const router = useRouter();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  // Date-only range inputs must use the same local calendar convention as
  // resolveUsageRange. Serialising with toISOString() would move the default
  // day around UTC midnight and make the visible range disagree with the
  // server-composed read model.
  const [from, setFrom] = useState(localDateDaysAgo(29));
  const [to, setTo] = useState(localDateDaysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");

  // 快照自愈轮询（空状态 + 过期状态）：
  // - 首次扫描空状态：loader 已触发非阻塞刷新，轮询轻量状态探测直到 revision
  //   落地，然后重跑路由 loader（design §4.3 Empty -> Refreshing -> Fresh）；
  // - 快照过期（web 运行时没有调度器，loader 只会在 stale 时触发刷新）：轮询
  //   探测到 stale 即重跑 loader，刷新完成后自动展示最新 token，无需手动刷新。
  // 探测是 O(1) 的轻量 GET，fresh 时不做任何事。
  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        // 路由正在加载/过渡时跳过本 tick：此时 invalidate 会中止进行中的
        // loader 请求（客户端取消），并可能让服务端 SSR 流被取消后打出
        // "render was aborted" 噪音。下一 tick 再检查。
        if (router.state.status === "pending") return;
        const status = await getDashboardSnapshotStatus({
          data: data.locale,
        });
        if (disposed) return;
        if (status.status === "stale") {
          // 过期：重跑 loader（loader 会触发非阻塞刷新）；刷新完成前保持轮询
          void router.invalidate();
          return;
        }
        if (status.status === "empty" && status.revision != null) {
          // 空状态且首个 revision 已落地：刷新一次后停止轮询
          clearInterval(timer);
          void router.invalidate();
        }
      } catch {
        // transient probe failure; retry on the next tick
      }
    };
    // `timer` is a const captured by `poll`; the first probe runs right after
    // it is assigned, so the closure never observes the temporal dead zone.
    const timer = setInterval(() => void poll(), EMPTY_REFRESH_POLL_MS);
    void poll();
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [data.locale, router]);

  const isCustom = period === "custom";
  const standardKey: "today" | "7d" | "30d" | "all" =
    period === "today" ||
    period === "7d" ||
    period === "30d" ||
    period === "all"
      ? period
      : "30d";

  // Custom ranges (and tool-scoped standard windows) are projected on demand;
  // standard windows come from the loader projection.
  const { data: custom } = useQuery({
    queryKey: [
      "dashboard-custom-window",
      data.locale,
      isCustom ? "custom" : standardKey,
      isCustom ? from : "",
      isCustom ? to : "",
      selectedTool,
    ],
    queryFn: () =>
      getDashboardCustomWindow({
        data: {
          locale: data.locale,
          from,
          to,
          tool: selectedTool === "all" ? null : selectedTool,
        },
      }),
    enabled: isCustom || selectedTool !== "all",
    staleTime: 30_000,
  });

  const windowView: DashboardWindowSummary =
    isCustom || selectedTool !== "all"
      ? (custom?.window ?? data.windows[standardKey])
      : data.windows[standardKey];

  const view = useMemo(
    () => windowToView(windowView, data),
    [data, windowView],
  );
  // 会话快照缺失（首次启动或后台刷新尚未完成）时，每 15s 重新运行路由
  // loader：loader 会触发一次非阻塞的 sessions.refresh，快照落盘后下一次
  // 加载即携带真实会话数，无需手动刷新。会话就绪后轮询自动停止。
  const sessionsUnavailable = view.sessions == null;
  useEffect(() => {
    if (!sessionsUnavailable) return;
    let disposed = false;
    const timer = setInterval(() => {
      if (disposed) return;
      // 与快照轮询相同的保护：过渡中不打断进行中的加载。
      if (router.state.status === "pending") return;
      void router.invalidate();
    }, EMPTY_REFRESH_POLL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [router, sessionsUnavailable]);
  const today = useMemo(() => windowToView(data.windows.today, data), [data]);
  const hero = data.hero;
  const rangeLabel = useMemo(() => {
    switch (period) {
      case "today":
        return t("dashboard.period.today");
      case "7d":
        return t("dashboard.period.lastNDays", { count: 7 });
      case "30d":
        return t("dashboard.period.lastNDays", { count: 30 });
      case "all":
        return t("dashboard.period.all");
      default:
        return `${from.slice(5)} → ${to.slice(5)}`;
    }
  }, [from, period, t, to]);
  const baselineLabel = useMemo(() => {
    switch (period) {
      case "today":
        return t("dashboard.v2.baselineToday");
      case "7d":
        return t("dashboard.v2.baselineLastNDays", { count: 7 });
      case "30d":
        return t("dashboard.v2.baselineLastNDays", { count: 30 });
      default:
        return t("dashboard.v2.baselinePrevious");
    }
  }, [period, t]);
  // 热力图统计周期窗口：始终展示 12 个月，仅高亮该窗口（近 7 天 / 近 30 天…）。
  const focusRange = useMemo(
    () => resolveUsageRange(period, from, to),
    [from, period, to],
  );

  return (
    <div className="dashboard-v3 space-y-4 pb-12">
      <DashboardJarvisInsight hero={hero} rangeLabel={rangeLabel} />
      <DashboardTrustHero
        view={view}
        today={today}
        hero={hero}
        security={data.monitoring?.security}
      />
      {/* 时间范围：全页吸顶（与原型一致的横贯细条） */}
      <div className="dashboard-range-bar sticky top-0 z-30 -mx-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-y border-border/60 bg-background px-4 py-2 md:-mx-8 md:px-8 2xl:-mx-10 2xl:px-10">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="shrink-0 font-mono text-[10px] tracking-[0.14em] text-muted-foreground/70 uppercase">
            {t("dashboard.v2.overviewLabel")}
          </span>
          <span className="tt-num truncate font-mono text-[11px] text-muted-foreground">
            {format.formatTokens(view.totals.totalTokens)} tokens ·{" "}
            {view.estimatedCostUsd == null
              ? t("dashboard.kpi.unavailable")
              : format.formatUsd(view.estimatedCostUsd)}{" "}
            ·{" "}
            {view.sessions == null
              ? t("dashboard.kpi.unavailable")
              : `${format.formatNumber(view.sessions)} ${t("dashboard.v2.sessionsUnit")}`}
          </span>
        </div>
        <DashboardRangePicker
          period={period}
          from={from}
          to={to}
          onChange={(next) => {
            setPeriod(next.period);
            if (next.from) setFrom(next.from);
            if (next.to) setTo(next.to);
          }}
        />
      </div>
      <DashboardMetricGrid
        view={view}
        monitoring={hero.monitoring}
        security={data.monitoring?.security}
        baselineLabel={baselineLabel}
      />
      <DashboardToolSwitcher
        tools={view.tools}
        selected={selectedTool}
        onChange={setSelectedTool}
      />
      {/* P6-T6-05: on-demand Recharts panel; the boundary keeps the page
          usable if the chunk fails to load. */}
      <ChunkErrorBoundary>
        <Suspense fallback={<div className="dashboard-panel h-[280px]" />}>
          <DashboardTrendPanel view={view} baselineLabel={baselineLabel} />
        </Suspense>
      </ChunkErrorBoundary>
      <DashboardModelDonut view={view} baselineLabel={baselineLabel} />
      <DashboardProjectOverview view={view} baselineLabel={baselineLabel} />
      <DashboardContribHeatmap
        points={view.calendar}
        focusFrom={focusRange.fromDate}
        focusTo={focusRange.toDate}
        periodLabel={rangeLabel}
      />
      {/* The workstream panel appears only for a picked tool (reference:
          `agent !== "全部"`), not for the all-tools overview. */}
      {selectedTool !== "all" ? (
        <DashboardAgentWorkstreams view={view} selectedTool={selectedTool} />
      ) : null}
    </div>
  );
}
