import { lazy, Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { ChunkErrorBoundary } from "../../../components/ChunkErrorBoundary";
import { useI18n } from "../../../lib/i18n/context.tsx";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import { resolveUsageRange } from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardSummaryReadModel,
  DashboardWindowSummary,
} from "../summary-contracts.ts";
import { windowToView } from "../summary-contracts.ts";
import { getDashboardCustomWindow } from "../summary-query.ts";
import type { DashboardSnapshotStatus } from "../summary-query.ts";
import { useSecurityScanOverview } from "../../security-assessment/query/use-security-scan-overview.ts";
import {
  DashboardAgentWorkstreams,
  DashboardContribHeatmap,
  DashboardMetricGrid,
  DashboardModelDonut,
  DashboardProjectOverview,
  DashboardRangePicker,
  DashboardToolSwitcher,
  DashboardTrustHero,
} from "./dashboard-v2-sections.tsx";
import { resolveDashboardToolRailTools } from "./tool-rail-order.ts";
import { resolveWorkspaceInitializationState } from "./workspace-initialization-state.ts";

// P6-T6-05: Recharts trend panel is loaded on demand (not in the initial
// shared shell). The Suspense fallback keeps layout stable during load.
const DashboardTrendPanel = lazy(() =>
  import("./dashboard-trend-panel.tsx").then((module) => ({
    default: module.DashboardTrendPanel,
  })),
);

/** Fixed-size fallback prevents the page from jumping while Recharts loads. */
export function DashboardTrendFallback() {
  return (
    <div
      className="dashboard-panel flex h-[280px] items-end gap-3 overflow-hidden px-6 pb-6"
      aria-hidden="true"
    >
      {[32, 48, 40, 66, 54, 78, 62, 86, 72, 58, 76, 92].map((height, index) => (
        <span
          key={index}
          className="min-w-0 flex-1 animate-pulse rounded-t bg-surface-2"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

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
export function DashboardV2Page({
  data,
  snapshotStatus,
  onRetry,
}: {
  readonly data: DashboardSummaryReadModel;
  readonly snapshotStatus: DashboardSnapshotStatus["status"];
  readonly onRetry: () => Promise<void>;
}) {
  const { format, t } = useI18n();
  const securityScan = useSecurityScanOverview();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  // Date-only range inputs must use the same local calendar convention as
  // resolveUsageRange. Serialising with toISOString() would move the default
  // day around UTC midnight and make the visible range disagree with the
  // server-composed read model.
  const [from, setFrom] = useState(localDateDaysAgo(29));
  const [to, setTo] = useState(localDateDaysAgo(0));
  const [selectedTool, setSelectedTool] = useState("all");
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
    queryFn: ({ signal }) =>
      getDashboardCustomWindow({
        data: {
          locale: data.locale,
          from,
          to,
          tool: selectedTool === "all" ? null : selectedTool,
        },
        signal,
      }),
    enabled: isCustom || selectedTool !== "all",
    staleTime: 30_000,
  });

  // The selected-tool query is intentionally scoped to one source so the
  // detail panels can update. Keep a second, all-tools custom projection for
  // the tool rail: selecting a tool must not make that tool jump to the first
  // position just because the scoped projection contains fewer events.
  const { data: customAll } = useQuery({
    queryKey: [
      "dashboard-custom-window",
      data.locale,
      "custom",
      isCustom ? from : "",
      isCustom ? to : "",
      "all",
    ],
    queryFn: ({ signal }) =>
      getDashboardCustomWindow({
        data: {
          locale: data.locale,
          from,
          to,
          tool: null,
        },
        signal,
      }),
    enabled: isCustom && selectedTool !== "all",
    staleTime: 30_000,
  });

  const windowView: DashboardWindowSummary =
    isCustom || selectedTool !== "all"
      ? (custom?.window ?? data.windows[standardKey])
      : data.windows[standardKey];

  // The rail order is based on the unscoped window. Its content query may be
  // scoped after a click, but its button positions remain stable.
  const toolRailTools = resolveDashboardToolRailTools(
    selectedTool,
    windowView.tools,
    isCustom
      ? (customAll?.window.tools ?? data.tools)
      : data.windows[standardKey].tools,
  );

  const view = useMemo(
    () => windowToView(windowView, data),
    [data, windowView],
  );
  const sessionsUnavailable = view.sessions == null;
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
      case "all":
        return undefined;
      default:
        return t("dashboard.v2.baselinePrevious");
    }
  }, [period, t]);
  // 热力图统计周期窗口：始终展示 12 个月，仅高亮该窗口（近 7 天 / 近 30 天…）。
  const focusRange = useMemo(
    () => resolveUsageRange(period, from, to),
    [from, period, to],
  );
  const workspaceInitializationState = resolveWorkspaceInitializationState({
    hasUsageData: view.hasData,
    hasSessionData: !sessionsUnavailable,
    snapshotStatus,
  });

  return (
    <div className="space-y-4">
      {workspaceInitializationState === "loading" ? (
        <section
          className="dashboard-panel flex items-start gap-3 border border-primary/20 bg-primary/5"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
          <div className="space-y-1">
            <h2 className="text-sm font-medium">
              {t("dashboard.onboarding.workspaceInitializing")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.onboarding.workspaceInitializingDesc")}
            </p>
          </div>
        </section>
      ) : workspaceInitializationState === "failed" ? (
        <section
          className="dashboard-panel flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-destructive/5"
          role="alert"
        >
          <div className="space-y-1">
            <h2 className="text-sm font-medium">
              {t("dashboard.onboarding.workspaceInitializationFailed")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("dashboard.onboarding.workspaceInitializationFailedDesc")}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            onClick={() => void onRetry()}
          >
            {t("dashboard.onboarding.retryWorkspaceInitialization")}
          </button>
        </section>
      ) : null}
      <DashboardTrustHero
        view={view}
        today={today}
        hero={hero}
        security={data.monitoring?.security}
        securityScan={securityScan}
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
        securityScan={securityScan}
        baselineLabel={baselineLabel}
      />
      <DashboardToolSwitcher
        tools={toolRailTools}
        selected={selectedTool}
        onChange={setSelectedTool}
      />
      {/* P6-T6-05: on-demand Recharts panel; the boundary keeps the page
          usable if the chunk fails to load. */}
      <ChunkErrorBoundary>
        <Suspense fallback={<DashboardTrendFallback />}>
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
