import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Layers } from "lucide-react";
import {
  buildContextBreakdown,
  type LocalUsageContextBreakdownRow,
} from "../../lib/local-usage/context-breakdown";
import {
  breakdownComposition,
  formatTokens,
  shareOf,
  sourceLabel,
  cacheRate,
} from "../../lib/local-usage/presentation";
import { estimateUsageCost, formatCost } from "../../lib/pricing";
import type {
  LocalUsageEvent,
  LocalUsageBreakdown,
} from "../../lib/local-usage";
import { Panel } from "../tt";
import { BrandIcon, brandColorOf } from "../BrandIcon";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const categoryColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const RICH_CONTEXT_SOURCES = new Set(["claude-code", "codex", "grok"]);

type DimensionKey =
  "model" | "messages" | "reasoning" | "tool" | "mcp" | "skill" | "tokenType";

const dimensionLabels: Record<DimensionKey, string> = {
  model: "模型",
  messages: "Messages",
  reasoning: "推理",
  tool: "工具调用",
  mcp: "MCP",
  skill: "Skill",
  tokenType: "Token类型",
};

/** messageRoles 键 → 中文展示标签 */
const messageRoleLabels: Record<string, string> = {
  conversation_history: "对话历史",
  system_prefix: "系统提示词",
  user_input: "用户输入",
  assistant_reply: "助手回复",
  reasoning: "推理",
};

// ---------------------------------------------------------------------------
// Data builders
// ---------------------------------------------------------------------------

interface ToolRankRow {
  source: string;
  totalTokens: number;
  events: number;
}

function buildToolRanking(events: LocalUsageEvent[]): ToolRankRow[] {
  const map = new Map<string, { totalTokens: number; events: number }>();
  for (const event of events) {
    const row = map.get(event.source) ?? { totalTokens: 0, events: 0 };
    row.totalTokens += event.totalTokens;
    row.events += 1;
    map.set(event.source, row);
  }
  return [...map.entries()]
    .map(([source, value]) => ({ source, ...value }))
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.source.localeCompare(right.source),
    );
}

interface ModelBreakdownRow extends LocalUsageContextBreakdownRow {
  cost: ReturnType<typeof estimateUsageCost>;
}

function buildModelBreakdown(events: LocalUsageEvent[]): ModelBreakdownRow[] {
  const groups = new Map<string, LocalUsageEvent[]>();
  for (const event of events) {
    const list = groups.get(event.model) ?? [];
    list.push(event);
    groups.set(event.model, list);
  }

  return [...groups.entries()]
    .map(([model, modelEvents]) => {
      const row: LocalUsageContextBreakdownRow = {
        key: model,
        calls: modelEvents.length,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      };
      for (const e of modelEvents) {
        row.inputTokens += e.inputTokens;
        row.cachedInputTokens += e.cachedInputTokens;
        row.cacheCreationInputTokens += e.cacheCreationInputTokens;
        row.outputTokens += e.outputTokens;
        row.reasoningOutputTokens += e.reasoningOutputTokens;
        row.totalTokens += e.totalTokens;
      }
      return { ...row, cost: estimateUsageCost(modelEvents) };
    })
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

function buildTokenTypeRows(
  events: LocalUsageEvent[],
): LocalUsageContextBreakdownRow[] {
  const totals = events.reduce(
    (acc, event) => {
      acc.inputTokens += event.inputTokens;
      acc.cachedInputTokens += event.cachedInputTokens;
      acc.cacheCreationInputTokens += event.cacheCreationInputTokens;
      acc.outputTokens += event.outputTokens;
      acc.reasoningOutputTokens += event.reasoningOutputTokens;
      acc.totalTokens += event.totalTokens;
      return acc;
    },
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
  const mapped = breakdownComposition({
    key: "totals",
    events: events.length,
    ...totals,
  });
  return mapped.map((item) => ({
    key: item.label,
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: item.value,
  }));
}

// ---------------------------------------------------------------------------
// SegBar – thin 5-segment coloured bar for token composition
// ---------------------------------------------------------------------------

function SegBar({
  composition,
  total,
}: {
  composition: { label: string; value: number; color: string }[];
  total: number;
}) {
  if (total === 0 || composition.length === 0) return null;
  return (
    <div className="mt-1 flex h-[3px] w-full overflow-hidden rounded-[2px] bg-surface-2">
      {composition.map((seg, i) => (
        <span
          key={i}
          className="block h-full"
          title={`${seg.label} ${formatTokens(seg.value)}`}
          style={{
            width: `${(seg.value / total) * 100}%`,
            background: seg.color,
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceDetail – expanded view for "模型" tab rows
// ---------------------------------------------------------------------------

function SourceDetail({ events }: { events: LocalUsageEvent[] }) {
  const breakdown = useMemo(() => buildContextBreakdown(events), [events]);
  const total = breakdown.totals.totalTokens || 1;

  // 构建上下文来源树（对齐原型 5 节点）：
  // 会话消息 / 工具调用 / 推理 / MCP / Skill
  const roleBy = (key: string) =>
    breakdown.messageRoles.find((r) => r.key === key)?.totalTokens ?? 0;
  const messagesTokens =
    roleBy("conversation_history") +
    roleBy("system_prefix") +
    roleBy("user_input") +
    roleBy("assistant_reply");
  const reasoningTokens = roleBy("reasoning");
  const mcpTokens =
    breakdown.categories.find((c) => c.key === "mcp")?.totalTokens ?? 0;
  // 工具调用 = 全部 tools 减去 skills/mcp 分类（避免与 Skill/MCP 节点重复）
  const toolTokens = breakdown.tools
    .filter((t) => !t.key.startsWith("mcp_"))
    .reduce((s, t) => s + t.totalTokens, 0);
  const skillTokens = breakdown.skills.reduce((s, t) => s + t.totalTokens, 0);

  const nodes = [
    {
      label: "会话消息 Messages",
      tokens: messagesTokens,
      color: "var(--color-chart-1)",
      children: [
        { label: "对话历史", value: roleBy("conversation_history") },
        { label: "用户输入", value: roleBy("user_input") },
        { label: "助手回复", value: roleBy("assistant_reply") },
        { label: "系统提示词", value: roleBy("system_prefix") },
      ].filter((c) => c.value > 0),
    },
    {
      label: "工具调用 Tool calls",
      tokens: toolTokens,
      color: "var(--color-chart-2)",
      children: breakdown.tools
        .filter((t) => !t.key.startsWith("mcp_") && t.totalTokens > 0)
        .slice(0, 6)
        .map((t) => ({ label: t.key, value: t.totalTokens })),
    },
    {
      label: "推理 Reasoning",
      tokens: reasoningTokens,
      color: "var(--color-chart-3)",
      children:
        reasoningTokens > 0
          ? [{ label: "思考链", value: reasoningTokens }]
          : [],
    },
    {
      label: "MCP 服务 MCP servers",
      tokens: mcpTokens,
      color: "var(--color-chart-5)",
      children: breakdown.tools
        .filter((t) => t.key.startsWith("mcp_") && t.totalTokens > 0)
        .slice(0, 5)
        .map((t) => ({ label: t.key, value: t.totalTokens })),
    },
    {
      label: "Skill 注入 Skills",
      tokens: skillTokens,
      color: "var(--color-chart-4)",
      children: breakdown.skills
        .filter((s) => s.totalTokens > 0)
        .slice(0, 5)
        .map((s) => ({ label: s.key, value: s.totalTokens })),
    },
  ].filter((n) => n.tokens > 0);

  // 底部汇总
  const cacheHit = cacheRate(breakdown.totals);
  const skillCount = breakdown.skills.filter((s) => s.totalTokens > 0).length;
  const mcpCount = breakdown.tools.filter(
    (t) => t.key.startsWith("mcp_") && t.totalTokens > 0,
  ).length;
  const sessionCount = new Set(events.map((e) => e.sessionId).filter(Boolean))
    .size;

  return (
    <div className="mt-2 border-l-2 border-primary/40 pl-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {nodes.map((n) => (
          <div key={n.label} className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: n.color }}
              />
              <span className="truncate text-[10px] text-muted-foreground">
                {n.label}
              </span>
            </div>
            <div className="tt-num pl-3 text-[11px]">
              {formatTokens(n.tokens)}
              <span className="ml-1 text-muted-foreground">
                {((n.tokens / total) * 100).toFixed(1)}%
              </span>
            </div>
            {n.children.length > 0 && (
              <ul className="tt-num mt-0.5 space-y-0.5 pl-3 text-[10px] text-muted-foreground">
                {n.children.map((c) => (
                  <li key={c.label} className="flex justify-between gap-2">
                    <span className="truncate">{c.label.split(" ")[0]}</span>
                    <span>{formatTokens(c.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="tt-num mt-2 text-[10px] text-muted-foreground">
        缓存命中 <span className="text-ok">{cacheHit.toFixed(0)}%</span> ·{" "}
        {skillCount} skills · {mcpCount} MCP · {sessionCount} 会话
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EntityDetail – 8-cell stats grid for tool / mcp / skill / tokenType rows
// ---------------------------------------------------------------------------

interface EntityMetrics {
  callCount: number | null;
  distinctSessions: number | null;
  avgTokensPerCall: number | null;
  costEstimate: ReturnType<typeof estimateUsageCost> | null;
  cacheHitPercent: number | null;
}

function computeEntityMetrics(
  row: LocalUsageContextBreakdownRow,
  scopedEvents: LocalUsageEvent[],
): EntityMetrics {
  const matchingEvents = scopedEvents.filter((event) => {
    const tools = event.context?.tools ?? [];
    return tools.some((tool) => tool.name === row.key);
  });

  const sessions = new Set(
    matchingEvents
      .filter((e) => e.sessionId?.trim())
      .map((e) => e.sessionId!.trim()),
  );

  return {
    callCount: row.calls > 0 ? row.calls : null,
    distinctSessions: sessions.size > 0 ? sessions.size : null,
    avgTokensPerCall:
      row.calls > 0 && row.totalTokens > 0
        ? Math.round(row.totalTokens / row.calls)
        : null,
    costEstimate:
      matchingEvents.length > 0 ? estimateUsageCost(matchingEvents) : null,
    cacheHitPercent:
      row.inputTokens + row.cachedInputTokens + row.cacheCreationInputTokens > 0
        ? Math.round(cacheRate(row) * 10) / 10
        : null,
  };
}

function dash(value: number | string | null): string {
  if (value == null) return "--";
  if (typeof value === "number") return String(value);
  return value;
}

function EntityDetail({
  metrics,
  row,
}: {
  metrics: EntityMetrics;
  row: LocalUsageContextBreakdownRow;
}) {
  const cells: { label: string; value: string }[] = [
    { label: "调用次数", value: dash(metrics.callCount) },
    { label: "涉及会话", value: dash(metrics.distinctSessions) },
    {
      label: "单次均耗",
      value:
        metrics.avgTokensPerCall != null
          ? formatTokens(metrics.avgTokensPerCall)
          : "--",
    },
    {
      label: "费用",
      value:
        metrics.costEstimate != null
          ? formatCost(metrics.costEstimate, "CNY")
          : "--",
    },
    {
      label: "缓存命中",
      value:
        metrics.cacheHitPercent != null ? `${metrics.cacheHitPercent}%` : "--",
    },
    { label: "平均耗时", value: "--" },
    { label: "失败率", value: "--" },
    { label: "最近使用", value: "--" },
  ];

  return (
    <div className="border-t border-border/60 bg-surface-2/40 px-3 py-2">
      <div className="grid grid-cols-4 gap-x-2 gap-y-1.5">
        {cells.map((cell, i) => (
          <div key={i} className="flex flex-col text-[10px]">
            <span className="text-muted-foreground/70">{cell.label}</span>
            <span className="tt-num mt-0.5 text-foreground/80">
              {cell.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable model row
// ---------------------------------------------------------------------------

function ExpandableModelRow({
  row,
  index,
  isExpanded,
  onToggle,
  scopedTokens,
  scopedEvents,
}: {
  row: ModelBreakdownRow;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  scopedTokens: number;
  scopedEvents: LocalUsageEvent[];
}) {
  const modelEvents = useMemo(
    () => scopedEvents.filter((e) => e.model === row.key),
    [scopedEvents, row.key],
  );
  const composition = breakdownComposition(
    row as unknown as LocalUsageBreakdown,
  );
  const share = scopedTokens > 0 ? shareOf(row.totalTokens, scopedTokens) : 0;

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] hover:bg-accent/30"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: categoryColors[index % categoryColors.length] }}
        />
        <span className="truncate">{row.key}</span>
        <span className="tt-num ml-auto w-14 text-right">
          {formatTokens(row.totalTokens)}
        </span>
        <span className="tt-num w-14 whitespace-nowrap text-right text-muted-foreground">
          {formatCost(row.cost, "CNY")}
        </span>
        <span className="tt-num w-9 whitespace-nowrap text-right text-muted-foreground">
          {share.toFixed(1)}%
        </span>
      </button>
      <div className="px-2 pb-1.5">
        <SegBar composition={composition} total={row.totalTokens} />
      </div>
      {isExpanded && <SourceDetail events={modelEvents} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable entity row (tool / mcp / skill / tokenType)
// ---------------------------------------------------------------------------

function ExpandableEntityRow({
  row,
  index,
  isExpanded,
  onToggle,
  scopedEvents,
  scopedTokens,
  dimension,
}: {
  row: LocalUsageContextBreakdownRow;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  scopedEvents: LocalUsageEvent[];
  scopedTokens: number;
  dimension: DimensionKey;
}) {
  const share = scopedTokens > 0 ? shareOf(row.totalTokens, scopedTokens) : 0;
  const maxTokens = scopedTokens || row.totalTokens || 1;
  const barWidth = Math.max(2, (row.totalTokens / maxTokens) * 100);
  const metrics = useMemo(
    () =>
      dimension !== "tokenType"
        ? computeEntityMetrics(row, scopedEvents)
        : ({
            callCount: null,
            distinctSessions: null,
            avgTokensPerCall: null,
            costEstimate: null,
            cacheHitPercent: null,
          } satisfies EntityMetrics),
    [row, scopedEvents, dimension],
  );

  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] hover:bg-accent/30"
      >
        {isExpanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: categoryColors[index % categoryColors.length] }}
        />
        <span className="truncate" title={row.key}>
          {dimensionLabel(dimension, row.key)}
        </span>
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
          <span
            className="block h-full rounded-full"
            style={{
              width: `${barWidth}%`,
              background: categoryColors[index % categoryColors.length],
            }}
          />
        </span>
        <span className="tt-num w-14 text-right">
          {formatTokens(row.totalTokens)}
        </span>
        <span className="tt-num w-9 text-right text-muted-foreground">
          {share.toFixed(1)}%
        </span>
      </button>
      {isExpanded && <EntityDetail metrics={metrics} row={row} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToolRanking – left panel (unchanged)
// ---------------------------------------------------------------------------

function ToolRanking({
  toolRows,
  selectedSource,
  totalTokens,
  onSelect,
}: {
  toolRows: ToolRankRow[];
  selectedSource: string;
  totalTokens: number;
  onSelect: (source: string) => void;
}) {
  const allRow = (
    <button
      type="button"
      onClick={() => onSelect("__all__")}
      className={`flex w-full flex-col border-l-2 px-2 py-1.5 text-left text-xs transition-colors ${
        selectedSource === "__all__"
          ? "border-primary bg-accent/50"
          : "border-transparent hover:bg-accent/30"
      }`}
    >
      <span className="flex items-center gap-2">
        <Layers className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">全部工具</span>
        <span className="tt-num text-[10px] text-muted-foreground">100%</span>
      </span>
      <span className="mt-1 block h-[2px] w-full bg-surface-2">
        <span className="block h-full bg-primary" style={{ width: "100%" }} />
      </span>
    </button>
  );
  if (toolRows.length === 0) {
    return (
      <div className="flex flex-col">
        {allRow}
        <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
          无匹配
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {allRow}
      {toolRows.map((row) => {
        const share = shareOf(row.totalTokens, totalTokens);
        const isSelected = selectedSource === row.source;
        const label = sourceLabel(row.source);
        const color = brandColorOf(label);
        return (
          <button
            key={row.source}
            type="button"
            onClick={() => onSelect(row.source)}
            className={`flex w-full flex-col border-l-2 px-2 py-1.5 text-left text-xs transition-colors ${
              isSelected
                ? "border-primary bg-accent/50"
                : "border-transparent hover:bg-accent/30"
            }`}
          >
            <span className="flex items-center gap-2">
              <BrandIcon name={label} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="tt-num text-[10px] text-muted-foreground">
                {share.toFixed(0)}%
              </span>
            </span>
            <span className="mt-1 block h-[2px] w-full bg-surface-2">
              <span
                className="block h-full"
                style={{ width: `${Math.min(100, share)}%`, background: color }}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ContextBreakdownProps {
  events: LocalUsageEvent[];
}

export function ContextBreakdown({ events }: ContextBreakdownProps) {
  const [selectedSource, setSelectedSource] = useState<string>("__all__");
  const [query, setQuery] = useState("");
  const [dimension, setDimension] = useState<DimensionKey>("model");
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  // --- Tool ranking (left panel) ---

  const toolRows = useMemo(() => buildToolRanking(events), [events]);
  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length === 0) return toolRows;
    return toolRows.filter((row) =>
      sourceLabel(row.source).toLowerCase().includes(normalized),
    );
  }, [toolRows, query]);

  const scopedEvents = useMemo(
    () =>
      selectedSource === "__all__"
        ? events
        : events.filter((event) => event.source === selectedSource),
    [events, selectedSource],
  );

  const selectedToolTokens = scopedEvents.reduce(
    (sum, event) => sum + event.totalTokens,
    0,
  );
  const selectedToolCost = useMemo(
    () => estimateUsageCost(scopedEvents),
    [scopedEvents],
  );

  const breakdown = useMemo(
    () => buildContextBreakdown(scopedEvents),
    [scopedEvents],
  );
  const sourceHasRichContext = useMemo(() => {
    if (selectedSource === "__all__") {
      return events.some((event) => RICH_CONTEXT_SOURCES.has(event.source));
    }
    return RICH_CONTEXT_SOURCES.has(selectedSource);
  }, [events, selectedSource]);

  // --- Available dimension tabs ---

  const availableTabs = useMemo<DimensionKey[]>(() => {
    if (selectedSource === "__all__")
      return ["model", "messages", "reasoning", "tokenType"];
    if (sourceHasRichContext)
      return [
        "model",
        "messages",
        "reasoning",
        "tool",
        "mcp",
        "skill",
        "tokenType",
      ];
    return ["model", "messages", "reasoning", "tokenType"];
  }, [selectedSource, sourceHasRichContext]);

  // Keep dimension in sync when tabs change
  useEffect(() => {
    if (!availableTabs.includes(dimension)) {
      setDimension(availableTabs[0]);
      setExpandedKeys(new Set());
    }
  }, [availableTabs, dimension]);

  const handleDimensionChange = (key: DimensionKey) => {
    if (key !== dimension) {
      setDimension(key);
      setExpandedKeys(new Set());
    }
  };

  // --- Dimension rows ---

  const modelRows = useMemo(
    () => buildModelBreakdown(scopedEvents),
    [scopedEvents],
  );

  const dimensionRows = useMemo(():
    LocalUsageContextBreakdownRow[] | ModelBreakdownRow[] => {
    switch (dimension) {
      case "model":
        return modelRows;
      case "messages":
        return breakdown.messageRoles
          .filter((r) => r.key !== "reasoning" && r.totalTokens > 0)
          .map((r) => ({ ...r, key: messageRoleLabels[r.key] ?? r.key }));
      case "reasoning":
        return breakdown.messageRoles
          .filter((r) => r.key === "reasoning" && r.totalTokens > 0)
          .map((r) => ({ ...r, key: "推理" }));
      case "tool":
        return breakdown.tools.filter((r) => r.totalTokens > 0);
      case "mcp":
        return breakdown.categories.filter(
          (r) => r.key === "mcp" && r.totalTokens > 0,
        );
      case "skill":
        return breakdown.skills.filter((r) => r.totalTokens > 0);
      case "tokenType":
        return buildTokenTypeRows(scopedEvents);
    }
  }, [dimension, breakdown, scopedEvents, modelRows]);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // --- Render ---

  return (
    <Panel
      title="AI 工具构成 · 上下文来源"
      bodyClassName="p-0"
      action={
        <span className="tt-num text-[10px] text-muted-foreground">
          {formatTokens(selectedToolTokens)} ·{" "}
          {formatCost(selectedToolCost, "CNY")}
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,168px)_minmax(0,1fr)]">
        {/* Axis A — tool ranking */}
        <div className="flex min-h-0 flex-col border-border sm:border-r">
          <div className="border-b border-border p-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="筛选 AI 工具…"
              aria-label="筛选 AI 工具"
              className="h-6 w-full rounded-sm border border-border bg-surface-2 px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <div className="tt-xscroll max-h-[340px] min-h-0 flex-1 overflow-auto">
            <ToolRanking
              toolRows={filteredTools}
              selectedSource={selectedSource}
              totalTokens={toolRows.reduce(
                (sum, row) => sum + row.totalTokens,
                0,
              )}
              onSelect={setSelectedSource}
            />
          </div>
        </div>

        {/* Axis B — dimension breakdown */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap gap-1">
            {availableTabs.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handleDimensionChange(key)}
                className={`rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                  dimension === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-border-strong"
                }`}
              >
                {dimensionLabels[key]}
              </button>
            ))}
          </div>
          {dimensionRows.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
              当前维度暂无数据
            </div>
          ) : (
            <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
              <div className="flex flex-col">
                {dimension === "model"
                  ? (dimensionRows as ModelBreakdownRow[]).map((row, index) => (
                      <ExpandableModelRow
                        key={`model-${row.key}`}
                        row={row}
                        index={index}
                        isExpanded={expandedKeys.has(row.key)}
                        onToggle={() => toggleExpand(row.key)}
                        scopedTokens={selectedToolTokens}
                        scopedEvents={scopedEvents}
                      />
                    ))
                  : (dimensionRows as LocalUsageContextBreakdownRow[]).map(
                      (row, index) => (
                        <ExpandableEntityRow
                          key={`${dimension}-${row.key}`}
                          row={row}
                          index={index}
                          isExpanded={expandedKeys.has(row.key)}
                          onToggle={() => toggleExpand(row.key)}
                          scopedEvents={scopedEvents}
                          scopedTokens={selectedToolTokens}
                          dimension={dimension}
                        />
                      ),
                    )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dimensionLabel(dimension: DimensionKey, key: string): string {
  if (dimension === "tokenType") return tokenTypeLabel(key);
  return key;
}

function tokenTypeLabel(key: string): string {
  const map: Record<string, string> = {
    输入: "输入",
    输出: "输出",
    缓存读取: "缓存读取",
    缓存写入: "缓存写入",
    推理: "推理",
  };
  return map[key] ?? key;
}
