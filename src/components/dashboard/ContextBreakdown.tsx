import { useMemo, useState } from "react";
import {
  buildContextBreakdown,
  type LocalUsageContextBreakdownRow,
} from "../../lib/local-usage/context-breakdown";
import {
  breakdownComposition,
  formatTokens,
  shareOf,
  sourceLabel,
} from "../../lib/local-usage/presentation";
import { estimateUsageCost, formatCost } from "../../lib/pricing";
import type { LocalUsageEvent } from "../../lib/local-usage";

const categoryColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const RICH_CONTEXT_SOURCES = new Set(["claude-code", "codex", "grok"]);

type DimensionKey = "category" | "tool" | "skill" | "command" | "tokenType";

const dimensionLabels: Record<DimensionKey, string> = {
  category: "工具类别",
  tool: "工具",
  skill: "Skill",
  command: "命令",
  tokenType: "Token 类型",
};

/**
 * FR-005 — Context attribution panel.
 *
 * Two axes:
 *  - Axis A (left): tool ranking with each tool's share %, searchable by name.
 *    "全部工具" aggregate option shows the overall breakdown; selecting a tool
 *    filters to its events.
 *  - Axis B (right): Messages / Tool / Reasoning / MCP / Skill composition for
 *    the selected tool. Only Claude/Codex/Grok carry rich context logs; other
 *    tools degrade to a Token-type breakdown or show an empty state.
 */
export interface ContextBreakdownProps {
  events: LocalUsageEvent[];
}

export function ContextBreakdown({ events }: ContextBreakdownProps) {
  const [selectedSource, setSelectedSource] = useState<string>("__all__");
  const [query, setQuery] = useState("");
  const [dimension, setDimension] = useState<DimensionKey>("category");

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

  const dimensionRows = useMemo(() => {
    if (dimension === "tokenType") return buildTokenTypeRows(scopedEvents);
    const rows =
      dimension === "category"
        ? breakdown.categories
        : dimension === "tool"
          ? breakdown.tools
          : dimension === "skill"
            ? breakdown.skills
            : breakdown.commands;
    return rows.filter((row) => row.totalTokens > 0);
  }, [dimension, breakdown, scopedEvents]);

  const aggregateLabel =
    selectedSource === "__all__" ? "全部工具" : sourceLabel(selectedSource);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="tt-num">
          {formatTokens(selectedToolTokens)} ·{" "}
          {formatCost(selectedToolCost, "CNY")}
        </span>
        <span>{aggregateLabel}</span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[minmax(140px,200px)_1fr]">
        {/* Axis A — tool ranking */}
        <div className="flex min-h-0 flex-col">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索工具…"
            aria-label="搜索工具"
            className="mb-2 w-full rounded-sm border border-border bg-surface-2 px-2 py-1 text-[11px] outline-none"
          />
          <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
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

        {/* Axis B — composition breakdown */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-2 flex flex-wrap gap-1">
            {(
              [
                "category",
                "tool",
                "skill",
                "command",
                "tokenType",
              ] as DimensionKey[]
            ).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setDimension(key)}
                disabled={!sourceHasRichContext && key !== "tokenType"}
                className={`rounded-sm border px-2 py-1 text-[11px] transition-colors ${
                  dimension === key
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-border-strong"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {dimensionLabels[key]}
              </button>
            ))}
          </div>
          {!sourceHasRichContext && dimension !== "tokenType" ? (
            <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
              该工具暂无上下文构成数据
            </div>
          ) : dimensionRows.length === 0 ? (
            <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
              当前维度暂无数据
            </div>
          ) : (
            <DimensionList
              rows={dimensionRows}
              dimension={dimension}
              totalTokens={breakdown.totals.totalTokens}
              scopedTokens={selectedToolTokens}
            />
          )}
        </div>
      </div>
    </div>
  );
}

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
      className={`flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-[11px] transition-colors ${
        selectedSource === "__all__"
          ? "bg-primary/10 text-primary"
          : "hover:bg-accent/40"
      }`}
    >
      <span className="size-1.5 rounded-full bg-primary" />
      <span className="truncate">全部工具</span>
      <span className="tt-num ml-auto">
        {shareOf(totalTokens, totalTokens).toFixed(0)}%
      </span>
    </button>
  );
  if (toolRows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {allRow}
        <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">
          未匹配到工具
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {allRow}
      {toolRows.map((row, index) => {
        const share = shareOf(row.totalTokens, totalTokens);
        const isSelected = selectedSource === row.source;
        return (
          <button
            key={row.source}
            type="button"
            onClick={() => onSelect(row.source)}
            className={`flex w-full items-center gap-2 border-b border-border px-2 py-1.5 text-left text-[11px] transition-colors ${
              isSelected ? "bg-primary/10 text-primary" : "hover:bg-accent/40"
            }`}
          >
            <span
              className="size-1.5 rounded-full"
              style={{
                background: categoryColors[index % categoryColors.length],
              }}
            />
            <span className="truncate">{sourceLabel(row.source)}</span>
            <span className="h-1 flex-1 overflow-hidden bg-surface-2">
              <span
                className="block h-full"
                style={{
                  width: `${Math.min(100, share)}%`,
                  background: categoryColors[index % categoryColors.length],
                }}
              />
            </span>
            <span className="tt-num w-10 text-right">{share.toFixed(0)}%</span>
          </button>
        );
      })}
    </div>
  );
}

function DimensionList({
  rows,
  dimension,
  totalTokens,
  scopedTokens,
}: {
  rows: LocalUsageContextBreakdownRow[];
  dimension: DimensionKey;
  totalTokens: number;
  scopedTokens: number;
}) {
  // For the category/tool/skill/command dimensions the breakdown totals are
  // scoped to the selected tool. For tokenType we report against the selected
  // tool's own total — passed in as scopedTokens.
  const base = dimension === "tokenType" ? scopedTokens : totalTokens;
  const effectiveBase =
    base > 0 ? base : rows.reduce((sum, r) => sum + r.totalTokens, 0);
  const max = rows.reduce((max, r) => Math.max(max, r.totalTokens), 0) || 1;
  return (
    <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
      <div className="flex flex-col">
        {rows.map((row, index) => {
          const share =
            effectiveBase > 0 ? shareOf(row.totalTokens, effectiveBase) : 0;
          const width = Math.max(2, (row.totalTokens / max) * 100);
          return (
            <div
              key={`${dimension}-${row.key}`}
              className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5 text-[11px] last:border-0"
            >
              <span
                className="size-1.5 shrink-0 rounded-full"
                style={{
                  background: categoryColors[index % categoryColors.length],
                }}
              />
              <span className="w-32 shrink-0 truncate" title={row.key}>
                {dimensionLabel(dimension, row.key)}
              </span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${width}%`,
                    background: categoryColors[index % categoryColors.length],
                  }}
                />
              </span>
              <span className="tt-num w-14 text-right">
                {formatTokens(row.totalTokens)}
              </span>
              <span className="tt-num w-10 text-right text-muted-foreground">
                {share.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildTokenTypeRows(
  events: LocalUsageEvent[],
): LocalUsageContextBreakdownRow[] {
  // Reuse the presentation breakdownComposition on a synthesized totals row.
  // For per-source scoping we aggregate the events first.
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

function dimensionLabel(dimension: DimensionKey, key: string): string {
  if (dimension === "category") return categoryLabel(key);
  if (dimension === "tokenType") return tokenTypeLabel(key);
  return key;
}

function categoryLabel(key: string): string {
  const map: Record<string, string> = {
    messages: "对话消息",
    execution: "执行",
    planning: "规划",
    agent: "代理",
    browser: "浏览器",
    mcp: "MCP",
    skills: "Skill",
    other: "其他",
    text_response: "纯文本回复",
  };
  return map[key] ?? key;
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
