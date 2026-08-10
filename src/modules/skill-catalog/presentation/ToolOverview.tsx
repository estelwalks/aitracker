import { useEffect, useMemo, useState } from "react";
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
import {
  ChevronDown,
  ChevronRight,
  Info,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { BrandIcon, brandColorOf } from "../../../components/BrandIcon";
import { RangePicker, type RangeValue } from "../../../components/RangePicker";
import { useI18n } from "../../../lib/i18n/context";
import type { UsagePeriod } from "../../../lib/local-usage/presentation";
import { cn } from "../../../lib/utils";
import type { DashboardReadModel } from "../../dashboard/contracts";
import {
  buildToolOverview,
  type ToolOverviewBreakdownRow,
  type ToolOverviewCard,
  type ToolOverviewView,
} from "../application";

const DASH = "—";

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

/** 工牌墙：总 Token + 占比条 + 纵向三项关键计数（对齐原型 AgentBadgeWall）。 */
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
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => {
        const color = brandColorOf(card.name);
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
              "rounded-xl bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-surface-2",
              on && "ring-1 ring-foreground/25",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className="flex size-8 items-center justify-center rounded-lg"
                style={{ background: `${color}1f` }}
              >
                <BrandIcon name={card.name} className="size-4" color={color} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold tracking-tight">
                {card.name}
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: statusColor }}
                />
                {statusLabel}
              </span>
            </div>

            <div className="mt-4 flex items-end justify-between gap-2">
              <span className="tt-num font-mono text-2xl font-black tracking-tight">
                {format.formatTokens(card.tokens)}
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("skills.agentOverview.totalTokens")}
              </span>
            </div>

            <span className="mt-2.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.max(card.share, 3)}%`,
                  background: color,
                }}
              />
            </span>

            <div className="mt-3 space-y-1 font-mono text-[10.5px] text-muted-foreground">
              <p className="tt-num">
                {card.sessions == null
                  ? t("skills.agentOverview.sessionsUnavailable")
                  : t("skills.agentOverview.sessionsShort", {
                      count: format.formatNumber(card.sessions),
                    })}
              </p>
              <p className="tt-num">
                {card.cacheRate == null
                  ? t("skills.agentOverview.cacheUnavailable")
                  : t("skills.agentOverview.cacheRate", {
                      rate: format.formatPercent(card.cacheRate),
                    })}
                {" · "}
                {card.messages == null
                  ? DASH
                  : t("skills.agentOverview.messagesShort", {
                      count: format.formatNumber(card.messages),
                    })}
              </p>
              <p className="tt-num">
                {card.lastActiveAt
                  ? t("skills.agentOverview.lastActive", {
                      time: format.formatDateTime(card.lastActiveAt, false),
                    })
                  : card.detected
                    ? t("skills.agentOverview.inactiveCard")
                    : t("skills.agentOverview.noActivity")}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** 消耗趋势：柱状 + 趋势线，支持时间筛选（对齐原型 AgentTrendPanel）。 */
function TrendPanel({
  name,
  trend,
  totalTokens,
  avgTokens,
  peakTokens,
  rangeValue,
  onRangeChange,
}: {
  name: string;
  trend: readonly { date: string; tokens: number }[];
  totalTokens: number;
  avgTokens: number;
  peakTokens: number;
  rangeValue: RangeValue;
  onRangeChange: (value: RangeValue) => void;
}) {
  const { t, format } = useI18n();
  const color = brandColorOf(name);

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
  view,
}: {
  name: string;
  view: ToolOverviewView;
}) {
  const { t, format } = useI18n();
  const color = brandColorOf(name);

  const reused = view.tokenComposition.cachedInputTokens;
  const total = view.totalTokens;

  const compose = view.tokenComposition;
  const messagesTokens = compose.inputTokens + compose.outputTokens;
  const reasoningTokens = compose.reasoningOutputTokens;
  const tokenTotal = messagesTokens + reasoningTokens;
  const pct = (value: number) =>
    tokenTotal === 0 ? null : (value / tokenTotal) * 100;
  const toolCalls =
    view.context.find((row) => row.key === "toolCalls")?.count ?? 0;
  const skillCalls = view.skillUsage.observed ? view.skillUsage.calls : 0;

  const tree: ContextNode[] = [
    {
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
    },
    {
      id: "reasoning",
      label: t("skills.agentOverview.reasoningTokens"),
      tokens: reasoningTokens,
      calls: null,
      pct: pct(reasoningTokens),
      children: [
        {
          id: "reasoning-thinking",
          label: t("skills.agentOverview.contextThinkingTokens"),
          tokens: reasoningTokens,
          calls: null,
          pct: pct(reasoningTokens),
          children: [],
        },
      ],
    },
    {
      id: "system",
      label: t("skills.agentOverview.systemPrompt"),
      tokens: 0,
      calls: null,
      pct: null,
      note: t("skills.agentOverview.notSeparatelyObserved"),
      children: [],
    },
    {
      id: "tools",
      label: t("skills.agentOverview.toolCalls"),
      tokens: null,
      calls: toolCalls,
      pct: null,
      note: t("skills.agentOverview.compositionHint"),
      children: [],
    },
    {
      id: "skills",
      label: t("skills.agentOverview.contextSkillCalls"),
      tokens: null,
      calls: skillCalls > 0 ? skillCalls : null,
      pct: null,
      children: [],
    },
  ];

  return (
    <section className="rounded-xl bg-card p-4">
      <header className="flex items-center gap-2">
        <span
          className="flex size-7 items-center justify-center rounded-lg"
          style={{ background: `${color}1f` }}
        >
          <BrandIcon name={name} className="size-3.5" color={color} />
        </span>
        <h3 className="flex-1 truncate text-[13px] font-semibold tracking-tight">
          {t("skills.agentOverview.contextTreeTitle")}
        </h3>
        <span className="font-mono text-[10.5px] text-muted-foreground">
          {name}
        </span>
      </header>

      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-3 py-2.5">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
          {t("skills.agentOverview.cacheHitLabel")}
        </span>
        <span
          className="tt-num font-mono text-[15px] font-black"
          style={{ color }}
        >
          {view.cacheRate == null ? DASH : format.formatPercent(view.cacheRate)}
        </span>
        <span className="tt-num font-mono text-[11px] text-muted-foreground">
          {t("skills.agentOverview.contextCacheReused", {
            reused: format.formatTokens(reused),
            total: format.formatTokens(total),
          })}
        </span>
      </div>

      <ul className="mt-2 space-y-0.5">
        {tree.map((node) => (
          <ContextRow key={node.id} node={node} depth={0} color={color} />
        ))}
      </ul>
    </section>
  );
}

/** 消耗明细：模型 / 项目 维度 tab 切换 + 时间筛选（对齐原型 ToolModelPanel）。 */
function ToolModelPanel({
  name,
  mode,
  onModeChange,
  rows,
  totalTokens,
  rangeValue,
  onRangeChange,
}: {
  name: string;
  mode: "models" | "projects";
  onModeChange: (mode: "models" | "projects") => void;
  rows: readonly ToolOverviewBreakdownRow[];
  totalTokens: number;
  rangeValue: RangeValue;
  onRangeChange: (value: RangeValue) => void;
}) {
  const { t, format } = useI18n();
  const color = brandColorOf(name);
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
            ? t("skills.agentOverview.observedCalls", {
                count: format.formatNumber(row.events),
              })
            : row.sessions == null
              ? DASH
              : t("skills.agentOverview.sessionsShort", {
                  count: format.formatNumber(row.sessions),
                });
          const metaB = isModels
            ? row.estimatedCostUsd == null
              ? DASH
              : `${row.estimatedCostIsPartial ? "~" : ""}${format.formatUsd(row.estimatedCostUsd)}`
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
 * 工具概览（原型对齐）。`/agents` 只渲染这段；Skill 工作区由 `SkillsPage`
 * 在 `showWorkspace` 时追加渲染。
 */
export function ToolOverview({ usage }: { usage: DashboardReadModel }) {
  const { t, format } = useI18n();
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [toolPeriod, setToolPeriod] = useState<UsagePeriod>("30d");
  const [toolFrom, setToolFrom] = useState(daysAgo(29));
  const [toolTo, setToolTo] = useState(daysAgo(0));
  const [detailPeriod, setDetailPeriod] = useState<UsagePeriod>("30d");
  const [detailFrom, setDetailFrom] = useState(daysAgo(29));
  const [detailTo, setDetailTo] = useState(daysAgo(0));
  const [detailMode, setDetailMode] = useState<"models" | "projects">("models");
  const [insightIndex, setInsightIndex] = useState(0);
  const [typed, setTyped] = useState("");

  const toolOverview = useMemo(
    () =>
      buildToolOverview(usage.v2, selectedToolId, toolPeriod, toolFrom, toolTo),
    [selectedToolId, toolFrom, toolPeriod, toolTo, usage.v2],
  );
  const detailOverview = useMemo(
    () =>
      buildToolOverview(
        usage.v2,
        selectedToolId ?? toolOverview.selected?.id ?? null,
        detailPeriod,
        detailFrom,
        detailTo,
      ),
    [
      detailFrom,
      detailPeriod,
      detailTo,
      selectedToolId,
      toolOverview.selected?.id,
      usage.v2,
    ],
  );

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
    if (!isDetail) setInsightIndex(0);
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

  const insights = [
    ...(toolOverview.selected == null
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
              events: format.formatNumber(toolOverview.totalEvents),
              tokens: format.formatTokens(toolOverview.totalTokens),
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
              count: format.formatNumber(toolOverview.sessions),
            }),
          },
        ]),
  ];
  const insightIndexSafe = insights.length ? insightIndex % insights.length : 0;
  const line = insights[insightIndexSafe]?.description ?? "";

  // 打字机效果：逐字显示当前洞察，6 秒后轮换下一条（对齐原型 JarvisInsight）。
  useEffect(() => {
    setTyped("");
    let n = 0;
    const typer = setInterval(() => {
      n += 2;
      setTyped(line.slice(0, n));
      if (n >= line.length) clearInterval(typer);
    }, 18);
    const next = setTimeout(
      () =>
        setInsightIndex((v) =>
          insights.length ? (v + 1) % insights.length : 0,
        ),
      6000,
    );
    return () => {
      clearInterval(typer);
      clearTimeout(next);
    };
  }, [line, insightIndexSafe, insights.length]);

  return (
    <section className="space-y-5 pb-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("skills.agentOverview.title")}
        </h1>
      </div>

      <section className="relative overflow-hidden rounded-lg bg-card p-5">
        <span
          className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full opacity-[0.13] blur-3xl"
          style={{ background: "var(--ok)" }}
        />
        <div className="relative flex items-start gap-3.5">
          <span className="relative mt-0.5 shrink-0">
            <span className="tt-breathe relative flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2">
              <Sparkles className="size-4" strokeWidth={1.7} />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight">
                {selectedName} · {t("skills.agentOverview.dedicatedInsight")}
              </h2>
              <button
                type="button"
                disabled={insights.length < 2}
                onClick={() =>
                  setInsightIndex((v) =>
                    insights.length ? (v + 1) % insights.length : 0,
                  )
                }
                className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
              >
                <RefreshCw className="size-3" strokeWidth={2} />
                {t("skills.agentOverview.rotateInsight")}
              </button>
            </div>
            <p className="mt-2 min-h-[42px] text-[14px] leading-relaxed text-foreground/90">
              {typed}
              <span className="tt-breathe ml-1 inline-block h-[15px] w-[7px] translate-y-[2px] bg-foreground/60" />
            </p>
            <div className="mt-3 flex items-center gap-1.5">
              {insights.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={t("skills.agentOverview.insightDot", {
                    index: format.formatNumber(index + 1),
                  })}
                  onClick={() => setInsightIndex(index)}
                  className={cn(
                    "h-[3px] rounded-full transition-all duration-500",
                    index === insightIndexSafe
                      ? "w-6 bg-foreground/70"
                      : "w-2.5 bg-foreground/15",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <ToolBadgeWall
        cards={toolOverview.cards}
        selectedId={selected?.id ?? null}
        onPick={(id) => {
          setSelectedToolId(id);
          setInsightIndex(0);
        }}
      />

      <TrendPanel
        name={selectedName}
        trend={toolOverview.trend}
        totalTokens={toolOverview.totalTokens}
        avgTokens={averageTrendTokens}
        peakTokens={peakTrendTokens}
        rangeValue={toRangeValue(toolPeriod, toolFrom, toolTo)}
        onRangeChange={(value) => applyRange(value, false)}
      />

      <ContextTreePanel name={selectedName} view={toolOverview} />

      <ToolModelPanel
        name={selectedName}
        mode={detailMode}
        onModeChange={setDetailMode}
        rows={detailRows}
        totalTokens={detailOverview.totalTokens}
        rangeValue={toRangeValue(detailPeriod, detailFrom, detailTo)}
        onRangeChange={(value) => applyRange(value, true)}
      />
    </section>
  );
}
