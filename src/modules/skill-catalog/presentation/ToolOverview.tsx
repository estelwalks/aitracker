import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronRight, Info } from "lucide-react";

import { BrandIcon, brandColorOf } from "../../../components/BrandIcon";
import { JarvisInsight } from "../../../components/JarvisInsight";
import { RangePicker, type RangeValue } from "../../../components/RangePicker";
import { useI18n } from "../../../lib/i18n/context";
import type { UsagePeriod } from "../../../lib/local-usage/presentation";
import type { LocalUsageToolCategory } from "../../../lib/local-usage/types";
import { cn } from "../../../lib/utils";
import type { AgentUsageOverviewReadModel } from "../usage-overview-contracts";
import { getAgentUsageOverview } from "../usage-overview-query";
import type {
  ToolOverviewBreakdownRow,
  ToolOverviewCard,
  ToolOverviewView,
} from "../application";

const DASH = "—";
const BADGE_STEP = 240;

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** 工牌墙：紧凑横向滚动条 + 渐隐箭头（对齐原型 AgentBadgeWall）。 */
function ToolBadgeWall({
  cards,
  selectedId,
  onPick,
}: {
  cards: readonly ToolOverviewCard[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  const { t, format } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = () => {
    const el = trackRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    update();
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, []);

  const scrollBy = (dir: number) => {
    trackRef.current?.scrollBy({ left: dir * BADGE_STEP, behavior: "smooth" });
  };

  const arrowClass =
    "absolute top-1/2 z-30 grid size-[26px] -translate-y-1/2 place-items-center rounded-lg border border-border bg-card text-foreground shadow-md transition-[background,transform] hover:scale-[1.06] hover:bg-surface-2";

  return (
    <div className="relative sticky top-14 z-20 -mx-1 bg-background/85 px-1 py-2 backdrop-blur-[10px]">
      {canLeft && (
        <button
          type="button"
          aria-label={t("skills.agentOverview.scrollLeft")}
          onClick={() => scrollBy(-1)}
          className={`${arrowClass} left-1.5`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {canLeft && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-[25] w-7"
          style={{
            background:
              "linear-gradient(to right, var(--color-background), transparent)",
          }}
        />
      )}

      <div
        ref={trackRef}
        className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {cards.map((card) => {
          const color = card.color ?? brandColorOf(card.name);
          const on = selectedId === card.id;
          const statusLabel = card.active
            ? t("skills.agentOverview.active")
            : card.detected
              ? t("skills.agentOverview.inactiveCard")
              : t("skills.agentOverview.notInstalled");
          const statusColor = card.active
            ? "#34d399"
            : card.detected
              ? "#f5b64c"
              : "#6b7280";
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onPick(card.id)}
              className={cn(
                "relative flex shrink-0 snap-start items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                on ? "bg-surface-2" : "bg-card hover:bg-surface-2",
              )}
              style={
                on
                  ? {
                      background: `linear-gradient(180deg, ${color}22, transparent 70%), var(--surface-2)`,
                    }
                  : undefined
              }
            >
              <span
                className={cn(
                  "absolute inset-x-2 bottom-0 h-[2px] origin-left rounded-full transition-transform duration-200",
                  on ? "scale-x-100" : "scale-x-0",
                )}
                style={{ background: color }}
              />
              <span
                className="flex size-6 items-center justify-center rounded-md"
                style={{ background: `${color}1f` }}
              >
                <BrandIcon
                  name={card.icon ?? card.name}
                  className="size-3.5"
                  color={color}
                />
              </span>
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold tracking-tight whitespace-nowrap">
                  {card.name}
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: statusColor }}
                    title={statusLabel}
                  />
                </span>
                <span className="tt-num font-mono text-[10.5px] whitespace-nowrap text-muted-foreground">
                  {t("skills.agentOverview.badgeSubline", {
                    tokens:
                      card.tokens > 0 ? format.formatTokens(card.tokens) : DASH,
                    sessions:
                      card.sessions == null
                        ? DASH
                        : format.formatNumber(card.sessions),
                  })}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {canRight && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-[25] w-7"
          style={{
            background:
              "linear-gradient(to left, var(--color-background), transparent)",
          }}
        />
      )}
      {canRight && (
        <button
          type="button"
          aria-label={t("skills.agentOverview.scrollRight")}
          onClick={() => scrollBy(1)}
          className={`${arrowClass} right-1.5`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path
              d="M9 18l6-6-6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

/** 消耗趋势：柱状 + 趋势线，支持时间筛选（对齐原型 AgentTrendPanel）。 */
function TrendPanel({
  name,
  brandColor,
  brandIcon,
  trend,
  totalTokens,
  avgTokens,
  peakTokens,
  rangeValue,
  onRangeChange,
}: {
  name: string;
  /** 注册表 display.color（可空，回退名称启发式）。 */
  brandColor?: string;
  /** 注册表 display.icon（可空，回退名称匹配）。 */
  brandIcon?: string;
  trend: readonly { date: string; tokens: number }[];
  totalTokens: number;
  avgTokens: number;
  peakTokens: number;
  rangeValue: RangeValue;
  onRangeChange: (value: RangeValue) => void;
}) {
  const { t, format } = useI18n();
  const color = brandColor ?? brandColorOf(name);

  return (
    <section className="rounded-xl bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold tracking-tight">
            {name} · {t("skills.agentOverview.trend")}
          </h3>
          <p className="tt-num mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {t("skills.agentOverview.trendSummary", {
              tokens: format.formatTokens(totalTokens),
              average: format.formatTokens(avgTokens),
              peak: format.formatTokens(peakTokens),
            })}
          </p>
        </div>
        <RangePicker value={rangeValue} onChange={onRangeChange} />
      </header>

      {trend.length === 0 ? (
        <p className="grid min-h-[5.5rem] place-items-start text-sm text-muted-foreground">
          {t("skills.agentOverview.noActivity")}
        </p>
      ) : (
        <div className="mt-3 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={[...trend]}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="2 4"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => value.slice(5)}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
              <YAxis
                width={44}
                tickFormatter={(value: number) => format.formatTokens(value)}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              />
              <Tooltip
                cursor={{ fill: "var(--surface-2)" }}
                contentStyle={{
                  background: "var(--card)",
                  border: "none",
                  borderRadius: 10,
                  fontSize: 11,
                }}
                formatter={(value: number) => [
                  format.formatTokens(value),
                  t("skills.agentOverview.totalTokens"),
                ]}
              />
              <Bar
                dataKey="tokens"
                fill={color}
                fillOpacity={0.35}
                radius={[4, 4, 0, 0]}
              />
              <Line
                type="monotone"
                dataKey="tokens"
                stroke={color}
                strokeWidth={1.6}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

type ContextNode = {
  id: string;
  label: string;
  tokens: number | null;
  calls: number | null;
  pct: number | null;
  note?: string;
  children: ContextNode[];
};

function ContextRow({
  node,
  depth,
  color,
}: {
  node: ContextNode;
  depth: number;
  color: string;
}) {
  const { t, format } = useI18n();
  const [open, setOpen] = useState(false);
  const hasKids = node.children.length > 0;

  return (
    <li>
      <div
        className="flex items-center gap-2 rounded-md py-[5px] pr-2 transition-colors hover:bg-surface-2"
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={t("skills.agentOverview.compositionDetails")}
          >
            {open ? (
              <ChevronDown className="size-3.5" strokeWidth={2} />
            ) : (
              <ChevronRight className="size-3.5" strokeWidth={2} />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            depth === 0
              ? "text-[12.5px] font-semibold tracking-tight"
              : "text-[12px]",
            depth >= 2 && "font-mono text-muted-foreground",
          )}
        >
          {node.label}
        </span>

        {node.calls != null && (
          <span className="tt-num shrink-0 font-mono text-[10px] text-muted-foreground/70">
            {t("skills.agentOverview.callsTimes", {
              count: format.formatNumber(node.calls),
            })}
          </span>
        )}
        <span
          className="tt-num w-[62px] shrink-0 text-right font-mono text-[11px]"
          style={depth === 0 ? { color } : undefined}
        >
          {node.tokens == null ? DASH : format.formatTokens(node.tokens)}
        </span>
        <span className="tt-num w-[46px] shrink-0 text-right font-mono text-[10.5px] text-muted-foreground">
          {node.pct == null
            ? ""
            : `${node.pct < 0.05 ? "0.0" : node.pct.toFixed(1)}%`}
        </span>
      </div>

      {node.note && (
        <p
          className="flex gap-1.5 pr-2 pb-1.5 text-[10.5px] leading-relaxed text-muted-foreground"
          style={{ paddingLeft: `${depth * 16 + 24}px` }}
        >
          <Info className="mt-[2px] size-3 shrink-0" strokeWidth={1.8} />
          {node.note}
        </p>
      )}

      {open && hasKids && (
        <ul>
          {node.children.map((child) => (
            <ContextRow
              key={child.id}
              node={child}
              depth={depth + 1}
              color={color}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

/** 上下文构成：缓存条 + 可展开树（对齐原型 ContextTree）。 */
function ContextTreePanel({
  name,
  brandColor,
  brandIcon,
  view,
}: {
  name: string;
  brandColor?: string;
  brandIcon?: string;
  view: ToolOverviewView;
}) {
  const { t, format } = useI18n();
  const color = brandColor ?? brandColorOf(name);

  /** 工具调用类别中文映射（对齐原型 ContextTree 的 CN 映射语义）。 */
  const categoryLabel = (category: LocalUsageToolCategory): string => {
    switch (category) {
      case "messages":
        return t("skills.agentOverview.toolCategoryMessages");
      case "execution":
        return t("skills.agentOverview.toolCategoryExecution");
      case "planning":
        return t("skills.agentOverview.toolCategoryPlanning");
      case "agent":
        return t("skills.agentOverview.toolCategoryAgent");
      case "browser":
        return t("skills.agentOverview.toolCategoryBrowser");
      case "mcp":
        return t("skills.agentOverview.toolCategoryMcp");
      case "skills":
        return t("skills.agentOverview.toolCategorySkills");
      case "other":
        return t("skills.agentOverview.toolCategoryOther");
    }
  };

  const reused = view.tokenComposition.cachedInputTokens;
  const total = view.totalTokens;

  const compose = view.tokenComposition;
  const messagesTokens =
    compose.inputTokens +
    compose.cachedInputTokens +
    compose.cacheCreationInputTokens +
    compose.outputTokens;
  const reasoningTokens = view.reasoningAvailable
    ? compose.reasoningOutputTokens
    : null;
  const tokenTotal = messagesTokens + (reasoningTokens ?? 0);
  const pct = (value: number) =>
    tokenTotal === 0 ? null : (value / tokenTotal) * 100;
  const toolCalls =
    view.context.find((row) => row.key === "toolCalls")?.count ?? null;
  const toolOutputCalls =
    view.context.find((row) => row.key === "toolOutputCalls")?.count ?? null;
  const attributedToolTokens = view.toolCallDetails.reduce(
    (total, tool) => total + tool.attributedTokens,
    0,
  );
  const skillCalls = view.skillUsage.observed ? view.skillUsage.calls : null;

  const hasMessages =
    view.context.find((row) => row.key === "textResponses")?.available === true;
  const hasToolCalls =
    view.context.find((row) => row.key === "toolCalls")?.available === true;
  const hasToolOutputs =
    view.context.find((row) => row.key === "toolOutputCalls")?.available ===
    true;
  const tree: ContextNode[] = [];
  if (hasMessages) {
    tree.push({
      id: "messages",
      label: t("skills.agentOverview.messageTokens"),
      tokens: messagesTokens,
      calls: null,
      pct: pct(messagesTokens),
      children: [
        {
          id: "messages-input",
          label: t("skills.agentOverview.contextUserInput"),
          tokens: compose.inputTokens,
          calls: null,
          pct: pct(compose.inputTokens),
          children: [],
        },
        {
          id: "messages-output",
          label: t("skills.agentOverview.contextAssistantResponse"),
          tokens: compose.outputTokens,
          calls: null,
          pct: pct(compose.outputTokens),
          children: [],
        },
      ],
    });
  }
  if (view.reasoningAvailable) {
    tree.push({
      id: "reasoning",
      label: t("skills.agentOverview.reasoningTokens"),
      tokens: reasoningTokens,
      calls: null,
      pct: reasoningTokens == null ? null : pct(reasoningTokens),
      children: [
        {
          id: "reasoning-thinking",
          label: t("skills.agentOverview.contextThinkingTokens"),
          tokens: reasoningTokens,
          calls: null,
          pct: reasoningTokens == null ? null : pct(reasoningTokens),
          children: [],
        },
      ],
    });
  }
  if (hasToolOutputs) {
    tree.push({
      id: "tool-outputs",
      label: t("skills.agentOverview.toolOutputCalls"),
      tokens: null,
      calls: toolOutputCalls,
      pct: null,
      children: [],
    });
  }
  if (hasToolCalls) {
    tree.push({
      id: "tools",
      label: t("skills.agentOverview.toolCalls"),
      tokens: view.toolCallDetailsAvailable ? attributedToolTokens : null,
      calls: toolCalls,
      pct: null,
      note: view.toolCallDetailsAvailable
        ? t("skills.agentOverview.toolTokenAttributionHint")
        : undefined,
      children: view.toolCallDetails.map((tool) => ({
        id: `tool:${tool.category}:${tool.name}`,
        label: `${tool.name} · ${categoryLabel(tool.category)}`,
        tokens: tool.attributedTokens,
        calls: tool.calls,
        pct: null,
        children: [],
      })),
    });
  }
  if (view.skillUsage.observed) {
    tree.push({
      id: "skills",
      label: t("skills.agentOverview.contextSkillCalls"),
      tokens: null,
      calls: skillCalls,
      pct: null,
      children: [],
    });
  }

  return (
    <section className="rounded-xl bg-card p-4">
      <header className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-lg"
          style={{ background: `${color}1f` }}
        >
          <BrandIcon
            name={brandIcon ?? name}
            className="size-3.5"
            color={color}
          />
        </span>
        <h3 className="flex-1 truncate text-[13px] font-semibold tracking-tight">
          {t("skills.agentOverview.contextTreeTitle")}
        </h3>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {name}
        </span>
      </header>

      {view.cacheRate != null && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            {t("skills.agentOverview.cacheHitLabel")}
          </span>
          <span
            className="tt-num font-mono text-[15px] font-black"
            style={{ color }}
          >
            {view.cacheRate == null
              ? DASH
              : format.formatPercent(view.cacheRate)}
          </span>
          <span className="tt-num font-mono text-[11px] text-muted-foreground">
            {t("skills.agentOverview.contextCacheReused", {
              reused: format.formatTokens(reused),
              total: format.formatTokens(total),
            })}
          </span>
        </div>
      )}

      {view.hasContextBreakdown ? (
        <ul className="mt-2 space-y-0.5">
          {tree.map((node) => (
            <ContextRow key={node.id} node={node} depth={0} color={color} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          {view.measurement === "estimated"
            ? t("skills.agentOverview.estimatedModelOnly")
            : t("skills.agentOverview.contextUnavailable")}
        </p>
      )}
    </section>
  );
}

/** 消耗明细：模型 / 项目 维度 tab 切换 + 时间筛选（对齐原型 ToolModelPanel）。 */
function ToolModelPanel({
  name,
  brandColor,
  brandIcon,
  mode,
  onModeChange,
  rows,
  totalTokens,
  measurement,
  rangeValue,
  onRangeChange,
}: {
  name: string;
  brandColor?: string;
  brandIcon?: string;
  mode: "models" | "projects";
  onModeChange: (mode: "models" | "projects") => void;
  rows: readonly ToolOverviewBreakdownRow[];
  totalTokens: number;
  measurement: ToolOverviewView["measurement"];
  rangeValue: RangeValue;
  onRangeChange: (value: RangeValue) => void;
}) {
  const { t, format } = useI18n();
  const color = brandColor ?? brandColorOf(name);
  const max = rows[0]?.tokens || 1;
  const emptyLabel =
    mode === "models"
      ? t("skills.agentOverview.noModelDetail")
      : t("skills.agentOverview.noProjectDetail");
  const countLabel =
    mode === "models"
      ? t("skills.agentOverview.modelCount", {
          count: format.formatNumber(rows.length),
        })
      : t("skills.agentOverview.projectCount", {
          count: format.formatNumber(rows.length),
        });

  return (
    <section className="rounded-xl bg-card p-5">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">
          {name} · {t("skills.agentOverview.details")}
        </h2>
        <div className="flex items-center gap-0.5 rounded-lg bg-foreground/[0.05] p-0.5">
          <button
            type="button"
            onClick={() => onModeChange("models")}
            className={cn(
              "rounded-md px-3 py-1 font-mono text-[11px] transition-colors",
              mode === "models"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("skills.agentOverview.byModel")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("projects")}
            className={cn(
              "rounded-md px-3 py-1 font-mono text-[11px] transition-colors",
              mode === "projects"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("skills.agentOverview.byProject")}
          </button>
        </div>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {countLabel}
        </span>
        <span className="ml-auto">
          <RangePicker value={rangeValue} onChange={onRangeChange} />
        </span>
      </header>

      <ul className="mt-3 divide-y divide-border/40">
        {rows.length === 0 && (
          <li className="py-4 font-mono text-[11px] text-muted-foreground">
            {emptyLabel}
          </li>
        )}
        {rows.map((row) => {
          const isModels = mode === "models";
          const metaA = isModels
            ? t(
                measurement === "estimated"
                  ? "skills.agentOverview.estimatedObservations"
                  : "skills.agentOverview.observedCalls",
                {
                  count: format.formatNumber(row.events),
                },
              )
            : row.sessions == null
              ? DASH
              : t("skills.agentOverview.sessionsShort", {
                  count: format.formatNumber(row.sessions),
                });
          const metaB = isModels
            ? row.estimatedCostUsd == null
              ? DASH
              : row.estimatedCostIsPartial
                ? t("pricing.estimatedUnknown", {
                    amount: format.formatUsd(row.estimatedCostUsd),
                  })
                : t("pricing.estimated", {
                    amount: format.formatUsd(row.estimatedCostUsd),
                  })
            : t("skills.agentOverview.pctShort", {
                percent: format.formatNumber(
                  totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0,
                  { maximumFractionDigits: 1 },
                ),
              });
          return (
            <li key={row.key} className="flex items-center gap-3 py-2.5">
              <span
                className="w-[190px] shrink-0 truncate font-mono text-[12px] font-semibold"
                title={row.key}
              >
                {row.key}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max((row.tokens / max) * 100, 2)}%`,
                    background: color,
                  }}
                />
              </span>
              <span className="tt-num w-[92px] shrink-0 text-right font-mono text-[11.5px]">
                {format.formatTokens(row.tokens)}
              </span>
              <span className="tt-num w-[78px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {metaA}
              </span>
              <span className="tt-num w-[70px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                {metaB}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Agent概览（原型对齐）。`/agents` 只渲染这段；Skill 工作区由 `SkillsPage`
 * 在 `showWorkspace` 时追加渲染。服务端预构建紧凑视图（P1-T1-06），交互
 * （工具/周期切换）通过同一 server fn 获取新投影；renderer 不接收原始事件。
 */
export function ToolOverview({
  usage,
}: {
  usage: AgentUsageOverviewReadModel;
}) {
  const { t, format } = useI18n();
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [toolPeriod, setToolPeriod] = useState<UsagePeriod>("30d");
  const [toolFrom, setToolFrom] = useState(daysAgo(29));
  const [toolTo, setToolTo] = useState(daysAgo(0));
  const [detailPeriod, setDetailPeriod] = useState<UsagePeriod>("30d");
  const [detailFrom, setDetailFrom] = useState(daysAgo(29));
  const [detailTo, setDetailTo] = useState(daysAgo(0));
  const [detailMode, setDetailMode] = useState<"models" | "projects">("models");

  const { data: toolQuery } = useQuery({
    queryKey: [
      "agent-usage-overview",
      usage.locale,
      selectedToolId ?? "",
      toolPeriod,
      toolFrom,
      toolTo,
    ],
    queryFn: () =>
      getAgentUsageOverview({
        data: {
          locale: usage.locale,
          toolId: selectedToolId,
          period: toolPeriod,
          from: toolFrom,
          to: toolTo,
        },
      }),
    initialData: usage,
    staleTime: 30_000,
  });
  const toolOverview: ToolOverviewView = toolQuery.view;

  const selectedId = selectedToolId ?? toolOverview.selected?.id ?? null;
  const { data: detailQuery } = useQuery({
    queryKey: [
      "agent-usage-overview",
      usage.locale,
      selectedId ?? "",
      detailPeriod,
      detailFrom,
      detailTo,
    ],
    queryFn: () =>
      getAgentUsageOverview({
        data: {
          locale: usage.locale,
          toolId: selectedId,
          period: detailPeriod,
          from: detailFrom,
          to: detailTo,
        },
      }),
    enabled: selectedId != null,
    initialData: selectedId == null ? undefined : usage,
    staleTime: 30_000,
  });
  const detailOverview: ToolOverviewView = detailQuery?.view ?? toolOverview;

  const selected = toolOverview.selected;
  const selectedName = selected?.name ?? DASH;

  const toRangeValue = (
    period: UsagePeriod,
    from: string,
    to: string,
  ): RangeValue => {
    if (period === "custom") return { kind: "custom", from, to };
    if (period === "today") return { kind: "preset", key: "today" };
    if (period === "7d") return { kind: "preset", key: "7d" };
    if (period === "all") return { kind: "preset", key: "all" };
    return { kind: "preset", key: "30d" };
  };

  const applyRange = (next: RangeValue, isDetail: boolean) => {
    if (next.kind === "preset") {
      if (isDetail) setDetailPeriod(next.key);
      else setToolPeriod(next.key);
    } else {
      if (isDetail) {
        setDetailPeriod("custom");
        setDetailFrom(next.from);
        setDetailTo(next.to);
      } else {
        setToolPeriod("custom");
        setToolFrom(next.from);
        setToolTo(next.to);
      }
    }
  };

  const averageTrendTokens =
    toolOverview.trend.length === 0
      ? 0
      : toolOverview.totalTokens / toolOverview.trend.length;
  const peakTrendTokens = Math.max(
    ...toolOverview.trend.map((item) => item.tokens),
    0,
  );

  const detailRows =
    detailMode === "models" ? detailOverview.models : detailOverview.projects;

  // 洞察描述的口语化文案（对齐原型 buildAgentInsights 风格，数据仍来自真实派生值）。
  const rangeLabel =
    toolPeriod === "today"
      ? t("skills.agentOverview.range.today")
      : toolPeriod === "7d"
        ? t("skills.agentOverview.range.d7")
        : toolPeriod === "all"
          ? t("skills.agentOverview.range.all")
          : toolPeriod === "custom"
            ? t("skills.agentOverview.range.custom")
            : t("skills.agentOverview.range.d30");

  const insights = [
    ...(toolOverview.selected == null || !toolOverview.selected.active
      ? [
          {
            id: "empty",
            title: t("skills.agentOverview.insightTitle"),
            description: t("skills.agentOverview.noActivity"),
          },
        ]
      : [
          {
            id: "activity",
            title: t("skills.agentOverview.insightActivityTitle", {
              tool: toolOverview.selected.name,
            }),
            description: t("skills.agentOverview.insightActivityDescription", {
              rangeLabel,
              tool: toolOverview.selected.name,
              tokens: format.formatTokens(toolOverview.totalTokens),
              pct: format.formatNumber(Math.round(toolOverview.selected.share)),
            }),
          },
        ]),
    ...(toolOverview.cacheRate == null
      ? []
      : [
          {
            id: "cache",
            title: t("skills.agentOverview.insightCacheTitle"),
            description: t("skills.agentOverview.insightCacheDescription", {
              rate: format.formatPercent(toolOverview.cacheRate),
            }),
          },
        ]),
    ...(toolOverview.skillUsage.observed
      ? [
          {
            id: "skill",
            title: t("skills.agentOverview.insightSkillTitle"),
            description: t("skills.agentOverview.insightSkillDescription", {
              rangeLabel,
              count: format.formatNumber(toolOverview.skillUsage.calls),
            }),
          },
        ]
      : []),
    ...(toolOverview.sessions == null
      ? []
      : [
          {
            id: "sessions",
            title: t("skills.agentOverview.insightSessionTitle"),
            description: t("skills.agentOverview.insightSessionDescription", {
              rangeLabel,
              count: format.formatNumber(toolOverview.sessions),
            }),
          },
        ]),
  ];
  const heroTitle =
    selected == null
      ? t("skills.agentOverview.insightTitle")
      : `${selected.name} · ${t("skills.agentOverview.dedicatedInsight")}`;

  return (
    <section className="space-y-5 pb-12">
      <JarvisInsight
        variant="hero"
        title={heroTitle}
        lines={insights.map((item) => item.description)}
        rotateLabel={t("skills.agentOverview.rotateInsight")}
        dotsLabel={t("insights.dots")}
      />

      <ToolBadgeWall
        cards={toolOverview.cards}
        selectedId={selected?.id ?? null}
        onPick={(id) => {
          setSelectedToolId(id);
        }}
      />

      <TrendPanel
        name={selectedName}
        brandColor={selected?.color}
        brandIcon={selected?.icon}
        trend={toolOverview.trend}
        totalTokens={toolOverview.totalTokens}
        avgTokens={averageTrendTokens}
        peakTokens={peakTrendTokens}
        rangeValue={toRangeValue(toolPeriod, toolFrom, toolTo)}
        onRangeChange={(value) => applyRange(value, false)}
      />

      <ContextTreePanel
        name={selectedName}
        brandColor={selected?.color}
        brandIcon={selected?.icon}
        view={toolOverview}
      />

      <ToolModelPanel
        name={selectedName}
        brandColor={selected?.color}
        brandIcon={selected?.icon}
        mode={detailMode}
        onModeChange={setDetailMode}
        rows={detailRows}
        totalTokens={detailOverview.totalTokens}
        measurement={detailOverview.measurement}
        rangeValue={toRangeValue(detailPeriod, detailFrom, detailTo)}
        onRangeChange={(value) => applyRange(value, true)}
      />
    </section>
  );
}
