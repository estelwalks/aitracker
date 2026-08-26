import { Link, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Brain,
  Boxes,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Coins,
  FileText,
  LayoutGrid,
  Minus,
  Shield,
  ShieldCheck,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BrandIcon, brandColorOf } from "../../../components/BrandIcon.tsx";
import {
  DistillButton,
  notifyDistillStarted,
} from "../../../components/DistillButton.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip.tsx";
import { InsightCard } from "../../insights/index.ts";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { PUBLIC_TOOL_MANIFEST } from "../../../lib/tool-registry/public-manifest.generated.ts";
import type { SecurityScanOverview } from "../../security-assessment/index.ts";
import type { UsagePeriod } from "../../../lib/local-usage/presentation.ts";
import type {
  DashboardV2BreakdownRow,
  DashboardV2CalendarPoint,
  DashboardV2HeroView,
  DashboardV2Tool,
  DashboardV2View,
} from "../contracts.ts";
import type { MonitoringStatus } from "../../monitoring/contracts.ts";

/** 注册表工具 id → 展示配置（icon kind + 品牌色），浏览器安全投影。 */
const toolDisplayById = new Map(
  PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool]),
);

export function DashboardDeltaChip({
  value,
  className = "",
}: {
  value?: number | null;
  className?: string;
}) {
  const { format, t } = useI18n();
  if (value == null || !Number.isFinite(value)) {
    return (
      <span className="tt-text-caption font-mono text-muted-foreground">
        {t("dashboard.kpi.unavailable")}
      </span>
    );
  }
  const dir = value > 0 ? 1 : value < 0 ? -1 : 0;
  const ArrowIcon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  const tone =
    dir === 0
      ? "text-muted-foreground"
      : dir > 0
        ? "text-[var(--color-ok)]"
        : "text-[var(--color-warn)]";
  return (
    <span
      className={`tt-text-caption inline-flex items-center gap-0.5 font-mono ${tone} ${className}`}
      title={t("dashboard.kpi.vsPrevious")}
    >
      <ArrowIcon className="size-3" strokeWidth={2.2} />
      {value > 0 ? "+" : ""}
      {format.formatPercent(value)}
    </span>
  );
}

/** Dashboard hero consumes the shared page-insight envelope (M5 double mode). */
export function DashboardJarvisInsight() {
  const { t } = useI18n();
  return (
    <InsightCard
      surfaceId="dashboard"
      variant="hero"
      title={t("dashboard.v2.heroTitle")}
      dotsLabel={t("dashboard.v2.insightDotsAria")}
      rotateLabel={t("dashboard.v2.rotateInsight")}
    />
  );
}

export function DashboardTrustHero({
  view,
  today,
  hero,
  security,
  securityScan,
}: {
  view: DashboardV2View;
  today: DashboardV2View;
  hero: DashboardV2HeroView;
  security?: MonitoringStatus["security"];
  securityScan: SecurityScanOverview;
}) {
  const { t, format } = useI18n();
  const distill = view.outputAvailability.distillationOutputs;
  const dormantTools = Math.max(
    0,
    hero.monitoring.detectedTools - view.activeTools,
  );
  const distilledSkillCount =
    view.outputAvailability.distillationBreakdown.capability;
  const skillPart =
    distilledSkillCount == null
      ? t("dashboard.kpi.unavailable")
      : t("dashboard.v2.assetSkillCount", { count: distilledSkillCount });
  const distilledMemoryCount =
    view.outputAvailability.distillationBreakdown.memory;
  const memoryPart =
    distilledMemoryCount == null
      ? t("dashboard.kpi.unavailable")
      : t("dashboard.v2.assetMemoryCount", { count: distilledMemoryCount });
  const securityScanReal =
    securityScan.available &&
    !securityScan.loading &&
    securityScan.totalSkills > 0;
  const securityValue = securityScanReal
    ? `${format.formatNumber(securityScan.coverage)}/${format.formatNumber(securityScan.totalSkills)}`
    : security == null
      ? t("common.unknown")
      : `${format.formatNumber(security.cleanCount)}/${format.formatNumber(security.assessedAssetCount)}`;
  const securitySub =
    securityScanReal && securityScan.summary != null
      ? t("dashboard.v2.securitySafeUnsafe", {
          safe: securityScan.summary.cleanCount,
          unsafe:
            securityScan.summary.suspiciousCount +
            securityScan.summary.dangerousCount +
            securityScan.summary.unknownCount +
            securityScan.summary.failedAssetCount,
        })
      : securityScanReal
        ? t("dashboard.v2.securityNotScanned")
        : security == null
          ? t("dashboard.v2.securityNotScanned")
          : t("dashboard.v2.securitySafeUnsafe", {
              safe: security.cleanCount,
              unsafe:
                security.suspiciousCount +
                security.dangerousCount +
                security.unknownCount +
                security.failedAssetCount,
            });
  const todaySub =
    today.estimatedCostUsd == null
      ? t("dashboard.kpi.unavailable")
      : `${format.formatUsd(today.estimatedCostUsd)} · ${t("dashboard.v2.cacheLabel")} ${today.cacheRate == null ? t("dashboard.kpi.unavailable") : format.formatPercent(Math.round(today.cacheRate))}`;
  const cards = [
    {
      icon: Boxes,
      label: t("dashboard.v2.toolCoverageLabel"),
      value: format.formatNumber(hero.monitoring.detectedTools),
      sub: t("dashboard.v2.toolCountHint", {
        detected: hero.monitoring.detectedTools,
        active: view.activeTools,
        dormant: dormantTools,
      }),
      to: "/sources" as const,
      action: t("dashboard.v2.viewTools"),
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityLabel"),
      value: securityValue,
      sub: securitySub,
      to: "/security" as const,
      action: t("dashboard.v2.viewScan"),
      accent: true,
    },
    {
      icon: Brain,
      label: t("dashboard.v2.distillationAssetsLabel"),
      value:
        distill.available && distill.count != null
          ? format.formatNumber(distill.count)
          : t("dashboard.kpi.unavailable"),
      sub: `${skillPart} · ${memoryPart}`,
      to: "/distill" as const,
      action: t("dashboard.v2.viewAssets"),
    },
    {
      icon: Coins,
      label: t("dashboard.v2.todayUsage"),
      value: format.formatTokens(today.totals.totalTokens),
      sub: todaySub,
      to: "/tracker" as const,
      action: t("dashboard.v2.viewTokens"),
    },
  ];
  return (
    <TooltipProvider>
      <section>
        <div className="dashboard-spotlight-grid">
          {cards.map(
            ({ icon: Icon, label, value, sub, to, action, accent }) => (
              <article key={label} className="dashboard-spotlight-card">
                <div className="dashboard-spotlight-card-heading">
                  <p>{label}</p>
                  <Icon
                    className={
                      accent
                        ? "size-4 text-[var(--color-ok)]"
                        : "size-4 text-muted-foreground"
                    }
                    strokeWidth={1.8}
                  />
                </div>
                <strong className="tt-num">{value}</strong>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <small title={sub}>{sub}</small>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-[min(32rem,80vw)] whitespace-normal break-words tt-text-caption"
                  >
                    {sub}
                  </TooltipContent>
                </Tooltip>
                <Link to={to}>{action}</Link>
              </article>
            ),
          )}
        </div>
      </section>
    </TooltipProvider>
  );
}

/**
 * The reference dashboard keeps these eight period-scoped signals directly
 * below the hero. Every value comes from the same DashboardV2View; where the
 * local service has no real history source, the card remains explicitly
 * unavailable instead of manufacturing a count.
 */
export function DashboardMetricGrid({
  view,
  monitoring,
  security,
  securityScan,
  baselineLabel,
}: {
  view: DashboardV2View;
  monitoring: DashboardV2HeroView["monitoring"];
  security?: MonitoringStatus["security"];
  securityScan: SecurityScanOverview;
  /**
   * Comparison-baseline label for cards that show a delta (e.g. "较前 30 天").
   * Only delta cards append it to their hint line, matching the reference.
   */
  baselineLabel?: string;
}) {
  const { t, format } = useI18n();
  const unavailable = t("dashboard.kpi.unavailable");
  // 真实扫描历史（Electron IPC / 本地 companion API）解析成功后，安全扫描卡
  // 显示累计扫描次数（runCount），不再使用 monitoring 占位摘要；解析失败时
  // 保留原有服务端回退，绝不凭空捏造数字。
  const securityRunsReal = securityScan.available && !securityScan.loading;
  // 休眠 = 已检测 − 本周期活跃（与系统快照卡 toolCountHint 口径一致，
  // 保证「活跃 + 休眠 = 已检测」自洽；不用实时 liveTools，避免口径打架）
  const dormantTools = Math.max(0, monitoring.detectedTools - view.activeTools);
  const reportMetrics = view.outputAvailability;
  const anyReportsAvailable =
    reportMetrics.dailyReports.available ||
    reportMetrics.weeklyReports.available ||
    reportMetrics.monthlyReports.available;
  const reportTotal = anyReportsAvailable
    ? (reportMetrics.dailyReports.count ?? 0) +
      (reportMetrics.weeklyReports.count ?? 0) +
      (reportMetrics.monthlyReports.count ?? 0)
    : null;
  /**
   * 区间天数（原型 rangeDays 语义）：自定义区间按真实日期跨度，其余按预设；
   * "all" 固定为 90，避免用 1970 哨兵起点算出的虚假日均。
   */
  const days = useMemo(() => {
    if (view.period === "all") return 90;
    if (view.from && view.to) {
      const start = new Date(`${view.from}T00:00:00`).getTime();
      const end = new Date(`${view.to}T00:00:00`).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        return Math.max(1, Math.round((end - start) / 86400000) + 1);
      }
    }
    switch (view.period) {
      case "today":
        return 1;
      case "7d":
      case "week":
        return 7;
      case "30d":
      case "month":
        return 30;
      case "90d":
        return 90;
      case "180d":
        return 180;
      case "1y":
      case "year":
        return 365;
      default:
        return 90;
    }
  }, [view.from, view.period, view.to]);
  const availabilityValue = (value: {
    available: boolean;
    count: number | null;
  }) =>
    value.available && value.count != null
      ? format.formatNumber(value.count)
      : unavailable;
  const availabilityHint = (value: { available: boolean }) =>
    value.available
      ? t("dashboard.v2.selectedRange")
      : t("dashboard.v2.outputUnavailableHint");
  const cards = [
    {
      icon: Coins,
      label: t("dashboard.kpi.tokens"),
      value: format.formatTokens(view.totals.totalTokens),
      hint:
        view.estimatedCostUsd == null
          ? t("dashboard.v2.eventCount", { count: view.totals.events })
          : format.formatUsd(view.estimatedCostUsd),
      delta: view.comparison.tokens.deltaPercent,
      alwaysBaseline: true,
    },
    {
      icon: CircleDollarSign,
      label: t("dashboard.kpi.cost"),
      value:
        view.estimatedCostUsd == null
          ? unavailable
          : format.formatUsd(view.estimatedCostUsd),
      hint:
        view.estimatedCostUsd == null || view.estimatedCostIsPartial
          ? t("dashboard.kpi.costUnknownHint")
          : t("dashboard.v2.costDailyProjection", {
              daily: format.formatUsd(view.estimatedCostUsd / days),
              month: format.formatUsd((view.estimatedCostUsd / days) * 30),
            }),
      delta: view.comparison.cost.deltaPercent,
      alwaysBaseline: true,
    },
    {
      icon: Activity,
      label: t("dashboard.kpi.sessions"),
      value:
        view.sessions == null
          ? unavailable
          : format.formatNumber(view.sessions),
      hint:
        view.sessions == null
          ? t("dashboard.kpi.sessionUnavailableHint")
          : t("dashboard.v2.sessionAvgTokens", {
              tokens: format.formatTokens(
                view.sessions > 0 ? view.totals.totalTokens / view.sessions : 0,
              ),
            }),
      delta: view.comparison.sessions.deltaPercent,
      alwaysBaseline: true,
    },
    {
      icon: Zap,
      label: t("dashboard.v2.cacheLabel"),
      value:
        view.cacheRate == null
          ? unavailable
          : format.formatPercent(Math.round(view.cacheRate)),
      hint:
        view.cacheSavingsUsd == null
          ? t("dashboard.v2.cacheHint")
          : t("dashboard.v2.cacheSavingsAmount", {
              amount: format.formatUsd(view.cacheSavingsUsd),
            }),
      delta: view.comparison.cacheRate.deltaPercent,
      alwaysBaseline: true,
      baselineLabel: view.period === "all" ? undefined : baselineLabel,
    },
    {
      icon: Wrench,
      label: t("dashboard.v2.agentActivityLabel"),
      value: format.formatNumber(view.activeTools),
      hint: t("dashboard.v2.agentsDormantHint", {
        count: format.formatNumber(dormantTools),
      }),
      delta: null,
    },
    {
      icon: ShieldCheck,
      label: t("dashboard.v2.securityRunsLabel"),
      value: securityRunsReal
        ? t("dashboard.v2.securityRunsValue", {
            count: format.formatNumber(securityScan.runCount),
          })
        : security == null
          ? t("common.unknown")
          : availabilityValue(view.outputAvailability.securityRuns),
      hint: securityRunsReal
        ? securityScan.coverage > 0
          ? t("dashboard.v2.securityCoverage", {
              count: format.formatNumber(securityScan.coverage),
            })
          : t("dashboard.v2.securityNotScanned")
        : security == null
          ? t("dashboard.v2.securityNotScanned")
          : t("dashboard.v2.securityCoverage", {
              count: format.formatNumber(security.cleanCount),
            }),
      delta: null,
    },
    {
      icon: Brain,
      label: t("dashboard.v2.distillationOutputsLabel"),
      value: availabilityValue(view.outputAvailability.distillationOutputs),
      hint:
        view.outputAvailability.distillationBreakdown.capability == null ||
        view.outputAvailability.distillationBreakdown.memory == null
          ? availabilityHint(view.outputAvailability.distillationOutputs)
          : t("dashboard.v2.distillAssetCounts", {
              skill: format.formatNumber(
                view.outputAvailability.distillationBreakdown.capability,
              ),
              memory: format.formatNumber(
                view.outputAvailability.distillationBreakdown.memory,
              ),
            }),
      delta: null,
    },
    {
      icon: FileText,
      label: t("dashboard.v2.dailyReportsLabel"),
      value:
        reportTotal == null ? unavailable : format.formatNumber(reportTotal),
      hint:
        reportTotal == null
          ? availabilityHint(reportMetrics.dailyReports)
          : t("dashboard.v2.reportCounts", {
              daily: format.formatNumber(reportMetrics.dailyReports.count ?? 0),
              weekly: format.formatNumber(
                reportMetrics.weeklyReports.count ?? 0,
              ),
              monthly: format.formatNumber(
                reportMetrics.monthlyReports.count ?? 0,
              ),
            }),
      delta: null,
    },
  ] as const;
  return (
    <TooltipProvider>
      <section
        className="dashboard-metric-grid"
        aria-label={t("dashboard.v2.overviewLabel")}
      >
        {cards.map((card) => {
          const Icon = card.icon;
          const cardBaselineLabel =
            "baselineLabel" in card ? card.baselineLabel : baselineLabel;
          // 基准文案：有环比时（或卡片声明始终展示，如会话总数）追加「· 较前 N 天」
          const showBaseline =
            cardBaselineLabel &&
            (card.delta != null ||
              ("alwaysBaseline" in card && card.alwaysBaseline === true));
          const hintLine = showBaseline
            ? `${card.hint} · ${cardBaselineLabel}`
            : card.hint;
          return (
            <article key={card.label} className="dashboard-metric-card">
              <div className="flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-foreground/75 uppercase">
                <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{card.label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <strong className="tt-num tt-text-metric min-w-0 flex-1 truncate leading-none font-black tracking-tight">
                  {card.value}
                </strong>
                {card.delta != null ? (
                  <DashboardDeltaChip value={card.delta} className="shrink-0" />
                ) : null}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p
                    className="mt-1 truncate text-[10px] text-muted-foreground/70"
                    title={hintLine}
                  >
                    {hintLine}
                  </p>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-[min(32rem,80vw)] whitespace-normal break-words tt-text-caption"
                >
                  {hintLine}
                </TooltipContent>
              </Tooltip>
            </article>
          );
        })}
      </section>
    </TooltipProvider>
  );
}

export function DashboardRangePicker({
  period,
  from,
  to,
  onChange,
}: {
  period: UsagePeriod;
  from: string;
  to: string;
  onChange: (next: { period: UsagePeriod; from?: string; to?: string }) => void;
}) {
  const { t } = useI18n();
  const customPopoverId = useId();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const presets: readonly (
    | { period: "today" | "all"; label: string }
    | { period: "7d" | "30d"; days: 7 | 30 }
  )[] = [
    { period: "today", label: t("dashboard.period.today") },
    { period: "7d", days: 7 },
    { period: "30d", days: 30 },
    { period: "all", label: t("dashboard.period.all") },
  ];
  return (
    <div
      className="relative flex items-center gap-1 rounded-xl bg-surface p-1"
      role="group"
      aria-label={t("dashboard.v2.rangeLabel")}
    >
      {presets.map((preset) => (
        <button
          key={preset.period}
          type="button"
          onClick={() => {
            setOpen(false);
            onChange({ period: preset.period });
          }}
          aria-pressed={period === preset.period}
          className={period === preset.period ? "dashboard-range-active" : ""}
        >
          {"label" in preset
            ? preset.label
            : t("dashboard.period.lastNDays", { count: preset.days })}
        </button>
      ))}
      <button
        type="button"
        onClick={() => {
          setDraftFrom(from);
          setDraftTo(to);
          setOpen((value) => !value);
        }}
        aria-controls={customPopoverId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-pressed={period === "custom"}
        className={
          period === "custom"
            ? "dashboard-range-active inline-flex items-center gap-1.5"
            : "inline-flex items-center gap-1.5"
        }
      >
        <CalendarRange className="size-3.5" strokeWidth={1.8} />
        {period === "custom"
          ? `${from.slice(5)} → ${to.slice(5)}`
          : t("dashboard.period.custom")}
      </button>
      {open && (
        <form
          id={customPopoverId}
          className="dashboard-range-popover"
          role="dialog"
          aria-label={t("dashboard.period.customRange")}
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const nextFrom = values.get("from");
            const nextTo = values.get("to");
            if (
              typeof nextFrom !== "string" ||
              typeof nextTo !== "string" ||
              !nextFrom ||
              !nextTo ||
              nextFrom > nextTo
            ) {
              return;
            }
            onChange({ period: "custom", from: nextFrom, to: nextTo });
            setOpen(false);
          }}
        >
          <label className="space-y-1">
            <span className="tt-text-body block tracking-wide text-muted-foreground uppercase">
              {t("dashboard.header.customFrom")}
            </span>
            <input
              type="date"
              name="from"
              aria-label={t("dashboard.header.customFrom")}
              value={draftFrom}
              max={draftTo}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="tt-text-body w-full rounded-lg bg-surface px-2 py-1.5 font-mono font-normal outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="tt-text-body block tracking-wide text-muted-foreground uppercase">
              {t("dashboard.header.customTo")}
            </span>
            <input
              type="date"
              name="to"
              aria-label={t("dashboard.header.customTo")}
              value={draftTo}
              min={draftFrom}
              onChange={(event) => setDraftTo(event.target.value)}
              className="tt-text-body w-full rounded-lg bg-surface px-2 py-1.5 font-mono font-normal outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={!draftFrom || !draftTo || draftFrom > draftTo}
            className="tt-text-body col-span-2 mt-3 inline-flex min-h-[var(--tt-control-height)] items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 font-semibold text-background disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Check className="size-4" strokeWidth={2.2} />
            {t("common.confirm")}
          </button>
        </form>
      )}
    </div>
  );
}

const TOOL_RAIL_STEP = 200;

export function DashboardToolSwitcher({
  tools,
  selected,
  onChange,
}: {
  tools: readonly (DashboardV2Tool & { tokens: number; events: number })[];
  selected: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  // DashboardV2Page supplies the usage-sorted order. Keep it as-is instead of
  // retaining the first render's order in a client-side id list.
  const orderedTools = useMemo(() => [...tools], [tools]);

  const updateArrows = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  // SSR-safe: arrows start hidden and only appear once the client measures
  // overflow on the real layout.
  useEffect(() => {
    updateArrows();
    const el = trackRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateArrows);
    observer.observe(el);
    el.addEventListener("scroll", updateArrows, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", updateArrows);
    };
  }, [orderedTools.length]);

  const scrollRail = (direction: number) => {
    trackRef.current?.scrollBy({
      left: direction * TOOL_RAIL_STEP,
      behavior: "smooth",
    });
  };

  return (
    <div className="relative">
      {canLeft ? (
        <button
          type="button"
          aria-label={t("dashboard.v2.scrollLeft")}
          onClick={() => scrollRail(-1)}
          className="absolute top-1/2 left-1.5 z-30 grid size-[26px] -translate-y-1/2 place-items-center rounded-lg border border-border bg-card text-foreground shadow-md hover:bg-surface-2"
        >
          <ChevronLeft className="size-3.5" />
        </button>
      ) : null}
      {canLeft ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-20 w-7"
          style={{
            background:
              "linear-gradient(to right, var(--color-background), transparent)",
          }}
        />
      ) : null}
      <div
        ref={trackRef}
        className="dashboard-tool-rail"
        role="group"
        aria-label={t("dashboard.v2.toolsTitle")}
      >
        <button
          type="button"
          onClick={() => onChange("all")}
          aria-pressed={selected === "all"}
          className={selected === "all" ? "dashboard-tool-active" : ""}
        >
          <LayoutGrid className="size-4" strokeWidth={1.8} />
          {t("dashboard.context.allTools")}
        </button>
        {orderedTools.map((tool) => {
          // 优先使用工具注册表配置的品牌图标/配色，未配置时回退名称启发式
          const color = tool.color ?? brandColorOf(tool.name);
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => onChange(tool.id)}
              aria-pressed={selected === tool.id}
              className={selected === tool.id ? "dashboard-tool-active" : ""}
              style={{ "--dashboard-tool-color": color } as React.CSSProperties}
            >
              <BrandIcon name={tool.name} className="size-4" color={color} />
              {tool.name}
            </button>
          );
        })}
      </div>
      {canRight ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-20 w-7"
          style={{
            background:
              "linear-gradient(to left, var(--color-background), transparent)",
          }}
        />
      ) : null}
      {canRight ? (
        <button
          type="button"
          aria-label={t("dashboard.v2.scrollRight")}
          onClick={() => scrollRail(1)}
          className="absolute top-1/2 right-1.5 z-30 grid size-[26px] -translate-y-1/2 place-items-center rounded-lg border border-border bg-card text-foreground shadow-md hover:bg-surface-2"
        >
          <ChevronRight className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

const modelColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];
export function DashboardModelDonut({
  view,
  baselineLabel,
}: {
  view: DashboardV2View;
  baselineLabel?: string;
}) {
  const { format, t } = useI18n();
  const [restOpen, setRestOpen] = useState(false);
  const top = view.models.slice(0, 8);
  const rest = view.models.slice(8);
  const max = top[0]?.share ?? 1;
  const row = (item: DashboardV2BreakdownRow, index: number) => (
    <div key={item.key} className="space-y-1.5">
      <div className="flex items-end gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] font-semibold">
          {item.key}
        </span>
        {item.tools?.length ? (
          <div className="hidden shrink-0 items-center gap-1 sm:flex">
            {item.tools.map((tool) => {
              const display = toolDisplayById.get(tool);
              const color = display?.color ?? brandColorOf(tool);
              return (
                <span
                  key={tool}
                  title={tool}
                  className="grid size-4 place-items-center rounded-full bg-surface-2"
                >
                  <BrandIcon name={tool} className="size-2.5" color={color} />
                </span>
              );
            })}
          </div>
        ) : null}
        <span className="tt-num shrink-0 font-mono text-[11px] text-muted-foreground">
          {t("dashboard.v2.calls", {
            count: format.formatNumber(item.events),
          })}
        </span>
        <span className="tt-num w-16 shrink-0 text-right font-mono text-[12px] font-semibold">
          {format.formatTokens(item.tokens)}
        </span>
        <span className="tt-num w-14 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {item.estimatedCostUsd == null
            ? t("dashboard.kpi.unavailable")
            : format.formatUsd(item.estimatedCostUsd)}
        </span>
        <span className="tt-num w-12 shrink-0 text-right font-mono text-[11px]">
          {format.formatPercent(item.share)}
        </span>
        {item.deltaPercent != null ? (
          <span className="shrink-0">
            <DashboardDeltaChip value={item.deltaPercent} />
          </span>
        ) : null}
      </div>
      <div className="h-[3px] bg-surface-2">
        <div
          className="h-full"
          style={{
            width: `${Math.max(3, (item.share / max) * 100)}%`,
            background: modelColors[index % modelColors.length],
            boxShadow: `0 0 6px -1px ${modelColors[index % modelColors.length]}`,
          }}
        />
      </div>
    </div>
  );
  return (
    <section className="dashboard-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.modelsTitle")}</h2>
          <p>{t("dashboard.v2.modelHint", { count: view.modelCount })}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
          <DashboardDeltaChip value={view.comparison.tokens.deltaPercent} />
          {view.comparison.tokens.deltaPercent != null && baselineLabel ? (
            <span>{baselineLabel}</span>
          ) : null}
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {top.map(row)}
        {rest.length ? (
          <div>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg bg-surface px-2 py-1.5 text-left font-mono text-[10.5px] text-muted-foreground"
              onClick={() => setRestOpen((value) => !value)}
            >
              {t("dashboard.detail.items", { count: rest.length })}
              <ChevronDown
                className={restOpen ? "size-3 rotate-180" : "size-3"}
              />
            </button>
            {restOpen ? (
              <div className="mt-3 space-y-3">
                {rest.map((item, index) => row(item, index + top.length))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ThinRing({ rows }: { rows: readonly DashboardV2BreakdownRow[] }) {
  const circumference = 2 * Math.PI * 42;
  let offset = 0;
  return (
    <svg
      viewBox="0 0 100 100"
      className="size-[136px] -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke="var(--color-surface-2)"
        strokeWidth="10"
      />
      {rows.map((row, index) => {
        const length = (row.share / 100) * circumference;
        const circle = (
          <circle
            key={row.key}
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={modelColors[index % modelColors.length]}
            strokeWidth="10"
            strokeDasharray={`${Math.max(0, length - 1.4)} ${circumference}`}
            strokeDashoffset={-offset}
          />
        );
        offset += length;
        return circle;
      })}
    </svg>
  );
}

export function DashboardProjectOverview({
  view,
  baselineLabel,
}: {
  view: DashboardV2View;
  baselineLabel?: string;
}) {
  const { format, t } = useI18n();
  const [topN, setTopN] = useState<3 | 5 | 10>(5);
  const named = view.projects.filter((item) => item.key !== "other");
  const top = named.slice(0, topN);
  const share = top.reduce((sum, item) => sum + item.share, 0);
  const totalTokens = view.projects.reduce((sum, item) => sum + item.tokens, 0);
  const rest = named.slice(topN);
  const restShare = Math.max(0, Math.round((100 - share) * 10) / 10);
  return (
    <section className="dashboard-panel dashboard-projects-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <h2 className="text-[13px] font-semibold tracking-tight">
            {t("dashboard.v2.projectsTitle")}
          </h2>
          <span className="rounded-md bg-ok/10 px-1.5 py-0.5 font-mono text-[9.5px] text-ok">
            {t("dashboard.v2.projectActive")}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {baselineLabel && (
            <span className="hidden font-mono text-[10.5px] text-muted-foreground lg:inline">
              {t("dashboard.v2.projectComparePeriod", {
                baseline: baselineLabel,
              })}
            </span>
          )}
          <div className="flex items-center gap-0.5 rounded-full bg-surface-1 p-0.5">
            {([3, 5, 10] as const).map((count) => (
              <button
                key={count}
                type="button"
                onClick={() => setTopN(count)}
                className={`rounded-full px-2.5 py-1 font-mono text-[10px] tracking-wider transition-colors ${
                  topN === count
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                TOP {count}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row">
        <div className="flex min-w-[220px] flex-col items-center justify-center gap-5 bg-surface-1/40 px-6 py-5">
          <div className="relative flex items-center justify-center">
            <ThinRing rows={top} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="tt-num tt-text-metric font-mono leading-none font-black">
                {format.formatNumber(view.projectCount)}
              </span>
              <span className="mt-1 font-mono text-[9.5px] tracking-widest text-muted-foreground uppercase">
                {t("dashboard.v2.projectCountLabel")}
              </span>
            </div>
          </div>
          <div className="w-full space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10.5px] text-muted-foreground">
              <span>{t("dashboard.v2.projectTotalQuota")}</span>
              <span className="tt-num text-foreground">
                {format.formatTokens(totalTokens)}
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full bg-ok/60"
                style={{ width: `${Math.min(100, share)}%` }}
              />
            </div>
            <div className="font-mono text-[9.5px] text-muted-foreground">
              {t("dashboard.v2.projectTopShare", {
                count: topN,
                share: format.formatPercent(share),
              })}
            </div>
          </div>
        </div>

        <div className="min-w-0 flex-1 tt-xscroll">
          <table className="tt-table w-full">
            <thead>
              <tr className="font-mono text-[9.5px] tracking-wider text-muted-foreground uppercase">
                <th className="px-4 py-2.5 text-left font-medium">
                  {t("dashboard.v2.projectNameCol")}
                </th>
                <th
                  className="px-3 py-2.5 font-medium"
                  style={{ textAlign: "right" }}
                >
                  {t("dashboard.v2.projectShareCol")}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t("dashboard.v2.projectTokensCol")}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {t("dashboard.v2.projectSessionsCol")}
                </th>
                <th
                  className="px-4 py-2.5 font-medium"
                  style={{ textAlign: "right" }}
                >
                  {t("dashboard.v2.projectDeltaCol")}
                </th>
              </tr>
            </thead>
            <tbody className="font-mono text-[12px]">
              {top.map((item, index) => (
                <tr
                  key={item.key}
                  className="transition-colors hover:bg-surface-1/60"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <i
                        className="h-[3px] w-3 shrink-0"
                        style={{
                          background: modelColors[index % modelColors.length],
                        }}
                      />
                      <span className="truncate font-sans text-[12.5px] font-medium">
                        {item.key}
                      </span>
                    </div>
                  </td>
                  <td className="tt-num px-3 py-3 text-right font-semibold">
                    {format.formatPercent(item.share)}
                  </td>
                  <td className="tt-num px-3 py-3 text-right text-muted-foreground">
                    {format.formatTokens(item.tokens)}
                  </td>
                  <td className="tt-num px-3 py-3 text-right text-muted-foreground">
                    {item.sessions == null
                      ? t("dashboard.kpi.unavailable")
                      : format.formatNumber(item.sessions)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.deltaPercent != null ? (
                      <DashboardDeltaChip
                        value={item.deltaPercent}
                        className="justify-end"
                      />
                    ) : (
                      <DashboardDeltaChip
                        value={null}
                        className="justify-end"
                      />
                    )}
                  </td>
                </tr>
              ))}
              {restShare > 0 && (
                <tr className="text-muted-foreground">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 opacity-70">
                      <i className="h-[3px] w-3 shrink-0 bg-surface-2" />
                      <span className="font-sans text-[12px]">
                        {t("dashboard.v2.projectOther", {
                          count: rest.length,
                        })}
                      </span>
                    </div>
                  </td>
                  <td className="tt-num px-3 py-2.5 text-right">
                    {format.formatPercent(restShare)}
                  </td>
                  <td className="px-3 py-2.5 text-right opacity-50">--</td>
                  <td className="px-4 py-2.5 text-right opacity-50">--</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between bg-surface-1/40 px-4 py-2.5 font-mono text-[10.5px] text-muted-foreground">
        <span>
          {t("dashboard.v2.projectTotal", { count: view.projectCount })}
        </span>
        <Link
          to="/tracker"
          className="group inline-flex items-center gap-1.5 text-foreground transition-opacity hover:opacity-70"
        >
          {t("dashboard.v2.projectViewDetail")}
          <ArrowRight
            className="size-3 transition-transform group-hover:translate-x-0.5"
            strokeWidth={2}
          />
        </Link>
      </div>
    </section>
  );
}

/** 本地日期 +N 天（避免 UTC 时区偏移）。 */
function addLocalDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DashboardContribHeatmap({
  points,
  focusFrom,
  focusTo,
  periodLabel,
}: {
  points: readonly DashboardV2CalendarPoint[];
  /** 统计周期窗口起点（该窗口内高亮，其余淡出）；null = 整图高亮。 */
  focusFrom?: Date | null;
  /** 统计周期窗口终点。 */
  focusTo?: Date | null;
  /** 周期文案（如「近 30 天」），在标题中高亮展示。 */
  periodLabel?: string;
}) {
  const { format, t } = useI18n();
  // 完全没有活跃数据时也合成最近 365 天（全零），保证日历骨架始终有样式，
  // 不会渲染成空白面板。
  const cells = useMemo(() => {
    if (points.length > 0) return points.slice(-365);
    const out: DashboardV2CalendarPoint[] = [];
    const end = new Date();
    for (let i = 364; i >= 0; i -= 1) {
      const date = addLocalDays(end, -i);
      const key = localDayKey(date);
      out.push({
        date: key,
        tokens: 0,
        events: 0,
        cacheTokens: 0,
        netInputTokens: 0,
        outputTokens: 0,
        sessions: null,
        previousTokens: null,
        active: false,
      });
    }
    return out;
  }, [points]);
  const max = Math.max(...cells.map((point) => point.tokens), 1);
  const [hover, setHover] = useState<{
    key: string;
    point: DashboardV2CalendarPoint;
    left: number;
    top: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // 直接量滚动容器自身：clientWidth 含水平内边距（getComputedStyle 取真实
    // padding 值扣除）。容器宽度由父级布局决定、不受内容溢出影响，因此不会
    // 像「量内容元素」那样在溢出后锁死在旧宽度上——浏览器缩放/客户端窗口
    // 变化后立即自适应，无需刷新。scrollbar-gutter 已在本容器上关闭，
    // clientWidth - paddingX 即真实可用宽度。
    const measure = () => {
      const style = getComputedStyle(el);
      const padX =
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      setBox(el.clientWidth - padX);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // 浏览器缩放（Ctrl+滚轮 / Ctrl+±）改变视口 CSS 尺寸时，部分浏览器/
    // 窗口环境不触发 ResizeObserver —— 用 resize 与 visualViewport 兜底。
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);
  // 高亮窗口（日期键比较，避免时区偏移）。
  const focusStartKey = focusFrom ? localDayKey(focusFrom) : null;
  const focusEndKey = focusTo ? localDayKey(focusTo) : null;
  const inFocus = (point: DashboardV2CalendarPoint) =>
    (focusStartKey == null || point.date >= focusStartKey) &&
    (focusEndKey == null || point.date <= focusEndKey);
  // 头部统计跟随统计周期（高亮窗口），与「近 7 天 / 近 30 天」联动。
  const focusStats = useMemo(() => {
    const window = cells.filter(inFocus);
    let streak = 0;
    let longestStreak = 0;
    for (const point of window) {
      streak = point.events > 0 ? streak + 1 : 0;
      longestStreak = Math.max(longestStreak, streak);
    }
    return {
      activeDays: window.filter((point) => point.events > 0).length,
      totalTokens: window.reduce((sum, point) => sum + point.tokens, 0),
      longestStreak,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, focusStartKey, focusEndKey]);
  // 随容器宽度自适应：单元格恰好铺满可用宽度，任何缩放/窗口尺寸都无横向
  // 滚动（不设下限，避免窄容器下锁死为可拖动状态）。
  const GAP = 3;
  const LABEL_W = 26;
  type GridCell = DashboardV2CalendarPoint & { future: boolean };
  // 自然周网格（周日 → 周六）：窗口首日前补空、末日后标为 future（透明），
  // 与原型一致——周日是一周的开始，纵坐标标注周一/周三/周五。
  const grid = useMemo<GridCell[][]>(() => {
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (!first || !last) return [];
    const byDate = new Map(cells.map((point) => [point.date, point]));
    const windowEnd = new Date(`${last.date}T00:00:00`);
    const start = new Date(`${first.date}T00:00:00`);
    start.setDate(start.getDate() - start.getDay());
    const end = new Date(windowEnd);
    end.setDate(end.getDate() + (6 - end.getDay()));
    const out: GridCell[][] = [];
    for (
      let week = new Date(start);
      week <= end;
      week = addLocalDays(week, 7)
    ) {
      const column: GridCell[] = [];
      for (let day = 0; day < 7; day++) {
        const date = addLocalDays(week, day);
        const key = localDayKey(date);
        const observed = byDate.get(key);
        column.push({
          date: key,
          tokens: observed?.tokens ?? 0,
          events: observed?.events ?? 0,
          cacheTokens: observed?.cacheTokens ?? 0,
          netInputTokens: observed?.netInputTokens ?? 0,
          outputTokens: observed?.outputTokens ?? 0,
          sessions: null,
          previousTokens: null,
          active: observed?.active ?? false,
          future: date.getTime() > windowEnd.getTime(),
        });
      }
      out.push(column);
    }
    return out;
  }, [cells]);
  const columns = grid;
  // 随容器宽度自适应：单元格恰好铺满可用宽度，任何缩放/窗口尺寸都无横向
  // 滚动（无 10px 下限，避免窄容器下锁死为可拖动状态）。
  const cellSize =
    box > 0 && columns.length > 0
      ? (box - LABEL_W - (columns.length - 1) * GAP) / columns.length
      : 10;
  const gap = GAP;
  const weekdayLabels = [
    "",
    t("dashboard.heatmap.monday"),
    "",
    t("dashboard.heatmap.wednesday"),
    "",
    t("dashboard.heatmap.friday"),
    "",
  ];
  const monthTicks = useMemo(() => {
    const ticks: { column: number; label: string }[] = [];
    let previousMonth = -1;
    columns.forEach((column, columnIndex) => {
      const first = column[0];
      if (!first) return;
      const month = Number(first.date.slice(5, 7));
      if (month !== previousMonth) {
        ticks.push({
          column: columnIndex,
          label: format.formatDate(`${first.date}T00:00:00`, {
            month: "short",
            year: undefined,
            day: undefined,
          }),
        });
        previousMonth = month;
      }
    });
    return ticks;
  }, [columns, format]);
  const levelOf = (point: DashboardV2CalendarPoint) =>
    point.events === 0
      ? 0
      : Math.min(4, Math.max(1, Math.ceil((point.tokens / max) * 4)));
  return (
    <section className="dashboard-panel dashboard-calendar-panel">
      <header className="dashboard-calendar-head">
        <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {t("dashboard.v2.calendarTitle")}
          {periodLabel ? (
            <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[9.5px] font-normal text-primary">
              {periodLabel}
            </span>
          ) : null}
        </h2>
        <p>
          {t("dashboard.v2.calendarHint", {
            count: focusStats.activeDays,
          })}{" "}
          · {t("dashboard.v2.streakHint", { count: focusStats.longestStreak })}{" "}
          ·{" "}
          {t("dashboard.v2.calendarTotalTokens", {
            tokens: format.formatTokens(focusStats.totalTokens),
          })}
        </p>
      </header>
      <div
        ref={wrapRef}
        className="tt-xscroll px-4 pt-4 pb-1"
        style={{ scrollbarGutter: "auto" }}
        aria-label={t("dashboard.v2.calendarTitle")}
      >
        <div className="inline-block min-w-full">
          <div className="flex">
            <div style={{ width: LABEL_W }} />
            <div className="relative h-6 flex-1">
              {monthTicks.map((tick) => (
                <span
                  key={`${tick.column}-${tick.label}`}
                  className="tt-num absolute top-0 text-[10px] leading-none text-muted-foreground"
                  style={{ left: tick.column * (cellSize + gap) }}
                >
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {/* 标签列与网格之间不加 gap（与原型一致），保证总宽恰好等于容器 */}
          <div className="mt-1.5 flex">
            <div
              className="tt-num flex shrink-0 flex-col text-[10px] leading-none text-muted-foreground"
              style={{ width: LABEL_W, gap }}
            >
              {weekdayLabels.map((label, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex items-center"
                  style={{ height: cellSize }}
                >
                  {label}
                </div>
              ))}
            </div>
            <div className="flex" style={{ gap }}>
              {columns.map((column, columnIndex) => (
                <div
                  key={columnIndex}
                  className="flex flex-col"
                  style={{ gap }}
                >
                  {column.map((point, rowIndex) => {
                    const level = point.future ? 0 : levelOf(point);
                    return (
                      <span
                        key={point.date}
                        title={
                          point.future
                            ? undefined
                            : `${point.date} · ${format.formatTokens(point.tokens)} · ${format.formatNumber(point.events)} ${t("dashboard.v2.eventShort")}`
                        }
                        onMouseEnter={
                          point.future
                            ? undefined
                            : (event) => {
                                const rect =
                                  event.currentTarget.getBoundingClientRect();
                                setHover({
                                  key: point.date,
                                  point,
                                  left: rect.left + rect.width / 2,
                                  top: rect.top,
                                });
                              }
                        }
                        onMouseLeave={() => setHover(null)}
                        className={`dashboard-calendar-cell dashboard-calendar-cell-level-${level} ${
                          hover?.key === point.date ? "ring-1 ring-primary" : ""
                        }`}
                        style={{
                          width: cellSize,
                          height: cellSize,
                          // 未来日期透明；统计周期窗口外淡出，窗口内高亮
                          opacity: point.future ? 0 : inFocus(point) ? 1 : 0.22,
                          background: point.future ? "transparent" : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-[10px] text-muted-foreground">
        <span>{t("dashboard.heatmap.legendNote")}</span>
        <span className="flex items-center gap-1.5">
          {t("dashboard.heatmap.low")}
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={`dashboard-calendar-cell dashboard-calendar-cell-level-${level}`}
            />
          ))}
          {t("dashboard.heatmap.high")}
        </span>
      </div>
      {hover != null
        ? (() => {
            const point = hover.point;
            const level = levelOf(point);
            return (
              <div
                className="pointer-events-none fixed z-50 w-[220px] -translate-x-1/2 -translate-y-full rounded-xl bg-card p-3 text-[11px] shadow-lg"
                style={{ left: hover.left, top: hover.top - 8 }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="tt-num font-mono text-[11px] text-muted-foreground">
                    {format.formatDate(point.date)}
                  </span>
                  <span
                    className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                    style={{
                      background:
                        "color-mix(in oklab, var(--color-ok) 15%, transparent)",
                      color: "var(--color-ok)",
                    }}
                  >
                    {t("dashboard.heatmap.hoverLevel", { level })}
                  </span>
                </div>
                {point.tokens === 0 ? (
                  <div className="mt-2 text-muted-foreground">
                    {t("dashboard.heatmap.noUsage")}
                  </div>
                ) : (
                  <>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="tt-num tt-text-metric font-mono leading-none font-black">
                        {format.formatTokens(point.tokens)}
                      </span>
                    </div>
                    <div className="tt-num mt-2 flex gap-3 font-mono text-[10px] text-muted-foreground">
                      <span>
                        {format.formatNumber(point.events)}{" "}
                        {t("dashboard.v2.eventShort")}
                      </span>
                      <span>
                        {t("dashboard.kpi.sessions")}{" "}
                        {point.sessions == null
                          ? t("dashboard.kpi.unavailable")
                          : format.formatNumber(point.sessions)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })()
        : null}
    </section>
  );
}

export function DashboardAgentWorkstreams({
  view,
  selectedTool,
}: {
  view: DashboardV2View;
  selectedTool: string;
}) {
  const { format, t } = useI18n();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(
    selectedTool === "all" ? null : selectedTool,
  );
  useEffect(
    () => setOpen(selectedTool === "all" ? null : selectedTool),
    [selectedTool],
  );
  const tools =
    selectedTool === "all"
      ? view.tools
      : view.tools.filter((tool) => tool.id === selectedTool);
  if (!tools.length) return null;
  return (
    <section className="dashboard-panel dashboard-workstream-panel">
      <div className="dashboard-panel-head">
        <div>
          <h2>{t("dashboard.v2.contextTitle")}</h2>
          <p>
            {tools.length} {t("dashboard.v2.toolsUnit")} ·{" "}
            {t("dashboard.v2.sortedBy")} · {t("dashboard.v2.clickForModels")}
          </p>
        </div>
        <Link
          to="/agents"
          className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t("dashboard.v2.manageAll")} →
        </Link>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {tools.map((tool) => {
          const expanded = open === tool.id;
          const live = tool.events > 0;
          const securityAvailable =
            view.outputAvailability.securityRuns.available;
          return (
            <li key={tool.id}>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
                  onClick={() => setOpen(expanded ? null : tool.id)}
                >
                  <BrandIcon
                    name={tool.name}
                    color={tool.color ?? brandColorOf(tool.name)}
                    className="size-5"
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {tool.name}
                  </span>
                  <span
                    className={`font-mono text-[10px] ${live ? "text-[var(--color-ok)]" : "text-muted-foreground"}`}
                  >
                    {live ? "LIVE" : "IDLE"}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {format.formatTokens(tool.tokens)} ·{" "}
                    {format.formatNumber(tool.events)}
                  </span>
                  <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">
                    —
                  </span>
                  <span
                    className={`hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-2 py-0.5 font-mono text-[10px] sm:inline-flex ${
                      securityAvailable
                        ? "border-border text-muted-foreground"
                        : "border-border text-muted-foreground/60"
                    }`}
                    title={
                      securityAvailable
                        ? t("dashboard.v2.scannedSafe")
                        : t("dashboard.v2.outputUnavailableHint")
                    }
                  >
                    <Shield className="size-3" />
                    {securityAvailable ? t("dashboard.v2.scannedSafe") : "—"}
                  </span>
                  <ChevronDown
                    className={expanded ? "size-4 rotate-180" : "size-4"}
                  />
                </button>
                <DistillButton
                  size="sm"
                  count={1}
                  className="shrink-0"
                  onClick={() =>
                    notifyDistillStarted({
                      sessions: 1,
                      minutes: 1,
                      t,
                      onGo: () => void navigate({ to: "/distill" }),
                    })
                  }
                />
              </div>
              {expanded ? (
                <div className="dashboard-workflow-grid mt-0 mb-3">
                  <div>
                    <dt>{t("dashboard.kpi.sessions")}</dt>
                    <dd>
                      {view.sessions == null
                        ? t("dashboard.kpi.unavailable")
                        : format.formatNumber(view.sessions)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.kpi.tokens")}</dt>
                    <dd>{format.formatTokens(view.totals.totalTokens)}</dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.responses")}</dt>
                    <dd>
                      {view.contextAvailability.textResponses
                        ? format.formatNumber(view.context.textResponses)
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.context.dimTool")}</dt>
                    <dd>
                      {view.contextAvailability.toolCalls
                        ? format.formatNumber(view.context.toolCalls)
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.securityLabel")}</dt>
                    <dd>
                      {view.outputAvailability.securityRuns.available
                        ? t("dashboard.v2.securityClean")
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("dashboard.v2.distillationOutputsLabel")}</dt>
                    <dd>
                      {view.outputAvailability.distillationOutputs.available
                        ? format.formatNumber(
                            view.outputAvailability.distillationOutputs.count ??
                              0,
                          )
                        : t("dashboard.kpi.unavailable")}
                    </dd>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
