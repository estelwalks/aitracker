import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import {
  buildContextBreakdown,
  type LocalUsageContextBreakdownRow,
  type LocalUsageObservedContextRow,
} from "../../lib/local-usage/context-breakdown";
import { shareOf, sourceLabel } from "../../lib/local-usage/presentation";
import { estimateUsageCost } from "../../lib/pricing";
import { formatCostLabel } from "../../lib/pricing/cost-label";
import type { LocalUsageEvent } from "../../lib/local-usage";
import { useI18n } from "../../lib/i18n/context";
import type { MessageKey } from "../../lib/i18n/messages";
import { Panel } from "../tt";
import { BrandIcon } from "../BrandIcon";
import { brandColorOf } from "../BrandIcon.helpers";

type DimensionKey =
  "model" | "messages" | "reasoning" | "tool" | "mcp" | "skill";

const DIMENSIONS: { key: DimensionKey; labelKey: MessageKey }[] = [
  { key: "model", labelKey: "dashboard.context.dimModel" },
  { key: "messages", labelKey: "dashboard.context.dimMessages" },
  { key: "reasoning", labelKey: "dashboard.context.dimReasoning" },
  { key: "tool", labelKey: "dashboard.context.dimTool" },
  { key: "mcp", labelKey: "dashboard.context.dimMcp" },
  { key: "skill", labelKey: "dashboard.context.dimSkill" },
];

const CATEGORY_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

interface ToolRankRow {
  source: string;
  totalTokens: number;
}

interface ModelRow extends LocalUsageContextBreakdownRow {
  cost: ReturnType<typeof estimateUsageCost>;
}

interface SourceChild {
  label: string;
  value: string;
}

type TFunction = ReturnType<typeof useI18n>["t"];

function buildToolRanking(events: LocalUsageEvent[]): ToolRankRow[] {
  const groups = new Map<string, number>();
  for (const event of events) {
    groups.set(
      event.source,
      (groups.get(event.source) ?? 0) + event.totalTokens,
    );
  }
  return [...groups]
    .map(([source, totalTokens]) => ({ source, totalTokens }))
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.source.localeCompare(right.source),
    );
}

function buildModelRows(events: LocalUsageEvent[], t: TFunction): ModelRow[] {
  const groups = new Map<string, LocalUsageEvent[]>();
  for (const event of events) {
    const group = groups.get(event.model) ?? [];
    group.push(event);
    groups.set(event.model, group);
  }
  return [...groups]
    .map(([key, modelEvents]) => {
      // buildContextBreakdown normalizes output to output-without-reasoning,
      // while preserving the scanner's total and cache conventions.
      const totals = buildContextBreakdown(modelEvents).totals;
      return {
        key: key || t("dashboard.context.unknownModel"),
        calls: modelEvents.length,
        ...totals,
        cost: estimateUsageCost(modelEvents),
      };
    })
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

function directMessageRows(
  t: TFunction,
  totals: LocalUsageContextBreakdownRow,
): LocalUsageContextBreakdownRow[] {
  const entries = [
    [t("dashboard.tokens.input"), "inputTokens"],
    [t("dashboard.tokens.cacheRead"), "cachedInputTokens"],
    [t("dashboard.tokens.cacheWrite"), "cacheCreationInputTokens"],
    [t("dashboard.tokens.output"), "outputTokens"],
  ] as const;
  return entries
    .map(([key, field]) => ({
      key,
      calls: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: totals[field],
    }))
    .filter((row) => row.totalTokens > 0);
}

function observedRowsFor(
  dimension: Extract<DimensionKey, "tool" | "mcp" | "skill">,
  events: LocalUsageEvent[],
): LocalUsageObservedContextRow[] {
  const breakdown = buildContextBreakdown(events);
  if (dimension === "tool") return breakdown.observedTools;
  if (dimension === "mcp") return breakdown.observedMcp;
  return breakdown.observedSkills;
}

function toolCallCount(rows: LocalUsageObservedContextRow[]): number {
  return rows.reduce((total, row) => total + row.calls, 0);
}

function SourceNode({
  color,
  label,
  value,
  children,
}: {
  color: string;
  label: string;
  value: string;
  children: SourceChild[];
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = children.length > 0;
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] enabled:hover:bg-accent/30 disabled:cursor-default"
      >
        {canExpand ? (
          expanded ? (
            <ChevronDown className="size-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3 text-muted-foreground" />
          )
        ) : (
          <span className="size-3" />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color }}
        />
        <span>{label}</span>
        <span className="tt-num ml-auto text-muted-foreground">{value}</span>
      </button>
      {expanded && (
        <div className="space-y-1 bg-surface-2/40 px-5 py-2 text-[10px] text-muted-foreground">
          {children.map((child) => (
            <div key={child.label} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
              <span className="tt-num shrink-0">{child.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceDetail({ events }: { events: LocalUsageEvent[] }) {
  const { t, format } = useI18n();
  const breakdown = useMemo(() => buildContextBreakdown(events), [events]);
  const total = breakdown.totals.totalTokens;
  const messages = directMessageRows(t, {
    key: "messages",
    calls: 0,
    ...breakdown.totals,
  });
  const messageTokens = messages.reduce((sum, row) => sum + row.totalTokens, 0);
  const observedTools = breakdown.observedTools;
  const observedMcp = breakdown.observedMcp;
  const observedSkills = breakdown.observedSkills;
  const hasParsedContext = events.some((event) => event.context != null);
  const tokenValue = (tokens: number) =>
    `${format.formatTokens(tokens)} · ${format.formatPercent(shareOf(tokens, total))}`;
  const callChildren = (rows: LocalUsageObservedContextRow[]): SourceChild[] =>
    rows.map((row) => ({
      label: row.key,
      value: t("dashboard.context.callSummary", {
        calls: row.calls,
        events: row.events,
      }),
    }));

  return (
    <div className="mt-1 border-l-2 border-primary/40">
      <SourceNode
        color={CATEGORY_COLORS[0]}
        label={t("dashboard.context.dimMessages")}
        value={tokenValue(messageTokens)}
        children={messages.map((row) => ({
          label: row.key,
          value: format.formatTokens(row.totalTokens),
        }))}
      />
      <SourceNode
        color={CATEGORY_COLORS[1]}
        label={t("dashboard.context.dimTool")}
        value={
          observedTools.length > 0
            ? t("dashboard.context.calls", {
                count: toolCallCount(observedTools),
              })
            : t("dashboard.context.noRecords")
        }
        children={callChildren(observedTools)}
      />
      <SourceNode
        color={CATEGORY_COLORS[2]}
        label={t("dashboard.context.dimReasoning")}
        value={tokenValue(breakdown.totals.reasoningOutputTokens)}
        children={
          breakdown.totals.reasoningOutputTokens > 0
            ? [
                {
                  label: t("dashboard.context.reasoningDirect"),
                  value: format.formatTokens(
                    breakdown.totals.reasoningOutputTokens,
                  ),
                },
              ]
            : []
        }
      />
      <SourceNode
        color={CATEGORY_COLORS[4]}
        label={t("dashboard.context.dimMcp")}
        value={
          observedMcp.length > 0
            ? t("dashboard.context.calls", {
                count: toolCallCount(observedMcp),
              })
            : t("dashboard.context.noRecords")
        }
        children={callChildren(observedMcp)}
      />
      <SourceNode
        color={CATEGORY_COLORS[3]}
        label={t("dashboard.context.dimSkill")}
        value={
          observedSkills.length > 0
            ? t("dashboard.context.calls", {
                count: toolCallCount(observedSkills),
              })
            : t("dashboard.context.noRecords")
        }
        children={callChildren(observedSkills)}
      />
      <p className="border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
        {t("dashboard.context.usageNote")}
      </p>
      {!hasParsedContext && (
        <p className="px-3 py-2 text-[10px] text-muted-foreground">
          {t("dashboard.context.usageNoteNoContext")}
        </p>
      )}
    </div>
  );
}

function ModelRow({
  row,
  index,
  expanded,
  onToggle,
  totalTokens,
  events,
}: {
  row: ModelRow;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  totalTokens: number;
  events: LocalUsageEvent[];
}) {
  const { t, format } = useI18n();
  const modelEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          (event.model || t("dashboard.context.unknownModel")) === row.key,
      ),
    [events, row.key, t],
  );
  const share = shareOf(row.totalTokens, totalTokens);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] hover:bg-accent/30"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
          }}
        />
        <span className="min-w-0 flex-1 truncate">{row.key}</span>
        <span className="tt-num w-14 text-right">
          {format.formatTokens(row.totalTokens)}
        </span>
        <span className="tt-num w-14 text-right text-muted-foreground">
          {formatCostLabel(t, format, row.cost)}
        </span>
        <span className="tt-num w-9 text-right text-muted-foreground">
          {format.formatPercent(share)}
        </span>
      </button>
      {expanded && <SourceDetail events={modelEvents} />}
    </div>
  );
}

function TokenRow({
  row,
  index,
  totalTokens,
}: {
  row: LocalUsageContextBreakdownRow;
  index: number;
  totalTokens: number;
}) {
  const { format } = useI18n();
  const share = shareOf(row.totalTokens, totalTokens);
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-2 py-2 text-[11px] last:border-0">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }}
      />
      <span className="min-w-0 flex-1 truncate">{row.key}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.max(0, Math.min(100, share))}%`,
            background: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
          }}
        />
      </span>
      <span className="tt-num w-14 text-right">
        {format.formatTokens(row.totalTokens)}
      </span>
      <span className="tt-num w-9 text-right text-muted-foreground">
        {format.formatPercent(share)}
      </span>
    </div>
  );
}

function ObservedCallRow({
  row,
  index,
}: {
  row: LocalUsageObservedContextRow;
  index: number;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-1.5 px-2 py-2 text-left text-[11px] hover:bg-accent/30"
      >
        {expanded ? (
          <ChevronDown className="size-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3 text-muted-foreground" />
        )}
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
          }}
        />
        <span className="min-w-0 flex-1 truncate">{row.key}</span>
        <span className="tt-num text-muted-foreground">
          {t("dashboard.context.calls", { count: row.calls })}
        </span>
      </button>
      {expanded && (
        <p className="bg-surface-2/40 px-5 py-2 text-[10px] text-muted-foreground">
          {t("dashboard.context.observedNote", { events: row.events })}
        </p>
      )}
    </div>
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
  const { t, format } = useI18n();
  const renderRow = (source: string, tokens: number, all = false) => {
    const selected = selectedSource === source;
    const share = all
      ? totalTokens > 0
        ? 100
        : 0
      : shareOf(tokens, totalTokens);
    const label = all ? t("dashboard.context.allTools") : sourceLabel(source);
    return (
      <button
        key={source}
        type="button"
        onClick={() => onSelect(source)}
        className={`flex w-full flex-col border-l-2 px-2 py-1.5 text-left text-xs transition-colors ${selected ? "border-primary bg-accent/50" : "border-transparent hover:bg-accent/30"}`}
      >
        <span className="flex items-center gap-2">
          {all ? (
            <Layers className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <BrandIcon name={label} className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="tt-num text-[10px] text-muted-foreground">
            {format.formatPercent(share)}
          </span>
        </span>
        <span className="mt-1 block h-[2px] w-full bg-surface-2">
          <span
            className="block h-full"
            style={{
              width: `${share}%`,
              background: all ? "var(--color-primary)" : brandColorOf(label),
            }}
          />
        </span>
      </button>
    );
  };
  return (
    <div>
      {renderRow("__all__", totalTokens, true)}
      {toolRows.map((row) => renderRow(row.source, row.totalTokens))}
    </div>
  );
}

export interface ContextBreakdownProps {
  events: LocalUsageEvent[];
}

export function ContextBreakdown({ events }: ContextBreakdownProps) {
  const { t, format } = useI18n();
  const [selectedSource, setSelectedSource] = useState("__all__");
  const [query, setQuery] = useState("");
  const [dimension, setDimension] = useState<DimensionKey>("model");
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const toolRows = useMemo(() => buildToolRanking(events), [events]);
  const filteredTools = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? toolRows.filter((row) =>
          sourceLabel(row.source).toLowerCase().includes(normalized),
        )
      : toolRows;
  }, [query, toolRows]);

  useEffect(() => {
    if (
      selectedSource !== "__all__" &&
      !toolRows.some((row) => row.source === selectedSource)
    )
      setSelectedSource("__all__");
  }, [selectedSource, toolRows]);

  const scopedEvents = useMemo(
    () =>
      selectedSource === "__all__"
        ? events
        : events.filter((event) => event.source === selectedSource),
    [events, selectedSource],
  );
  const selectedTokens = scopedEvents.reduce(
    (sum, event) => sum + event.totalTokens,
    0,
  );
  const selectedCost = useMemo(
    () => estimateUsageCost(scopedEvents),
    [scopedEvents],
  );
  const breakdown = useMemo(
    () => buildContextBreakdown(scopedEvents),
    [scopedEvents],
  );
  const models = useMemo(
    () => buildModelRows(scopedEvents, t),
    [scopedEvents, t],
  );
  const messageRows = useMemo(
    () =>
      directMessageRows(t, {
        key: "messages",
        calls: 0,
        ...breakdown.totals,
      }),
    [breakdown, t],
  );
  const reasoningRows = useMemo(
    () =>
      breakdown.totals.reasoningOutputTokens > 0
        ? [
            {
              key: t("dashboard.tokens.reasoning"),
              calls: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              cacheCreationInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: breakdown.totals.reasoningOutputTokens,
              totalTokens: breakdown.totals.reasoningOutputTokens,
            },
          ]
        : [],
    [breakdown, t],
  );
  const observedRows = useMemo(
    () =>
      dimension === "tool" || dimension === "mcp" || dimension === "skill"
        ? observedRowsFor(dimension, scopedEvents)
        : [],
    [dimension, scopedEvents],
  );
  const hasParsedContext = scopedEvents.some((event) => event.context != null);

  const toggleModel = (key: string) =>
    setExpandedModels((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const noDataMessage =
    dimension === "tool" || dimension === "mcp" || dimension === "skill"
      ? hasParsedContext
        ? t("dashboard.context.noDataNoCalls")
        : t("dashboard.context.noDataRequestOnly")
      : t("dashboard.context.noDataDimension");

  return (
    <Panel
      title={t("dashboard.context.title")}
      bodyClassName="p-0"
      action={
        <span className="tt-num text-[10px] text-muted-foreground">
          {format.formatTokens(selectedTokens)} ·{" "}
          {formatCostLabel(t, format, selectedCost)}
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,168px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-border sm:border-r">
          <div className="border-b border-border p-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("dashboard.context.filterPlaceholder")}
              aria-label={t("dashboard.context.filterAria")}
              className="h-6 w-full rounded-sm border border-border bg-surface-2 px-2 text-[11px] outline-none placeholder:text-muted-foreground focus:border-primary"
            />
          </div>
          <div className="tt-xscroll max-h-[340px] min-h-0 flex-1 overflow-auto">
            {filteredTools.length > 0 || query.trim().length === 0 ? (
              <ToolRanking
                toolRows={filteredTools}
                selectedSource={selectedSource}
                totalTokens={events.reduce(
                  (sum, event) => sum + event.totalTokens,
                  0,
                )}
                onSelect={setSelectedSource}
              />
            ) : (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                {t("dashboard.context.noMatch")}
              </p>
            )}
          </div>
        </div>
        <div className="flex min-h-0 flex-col p-2">
          <div className="mb-2 flex flex-wrap gap-1">
            {DIMENSIONS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setDimension(item.key);
                  setExpandedModels(new Set());
                }}
                className={`rounded-sm border px-2 py-1 text-[11px] transition-colors ${dimension === item.key ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-border-strong"}`}
              >
                {t(item.labelKey)}
              </button>
            ))}
          </div>
          {selectedTokens === 0 ? (
            <div className="flex min-h-24 flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
              {t("dashboard.context.noTokenData")}
            </div>
          ) : dimension === "model" ? (
            <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
              {models.map((row, index) => (
                <ModelRow
                  key={row.key}
                  row={row}
                  index={index}
                  expanded={expandedModels.has(row.key)}
                  onToggle={() => toggleModel(row.key)}
                  totalTokens={selectedTokens}
                  events={scopedEvents}
                />
              ))}
            </div>
          ) : dimension === "messages" || dimension === "reasoning" ? (
            <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
              {(dimension === "messages" ? messageRows : reasoningRows).map(
                (row, index) => (
                  <TokenRow
                    key={row.key}
                    row={row}
                    index={index}
                    totalTokens={selectedTokens}
                  />
                ),
              )}
            </div>
          ) : observedRows.length > 0 ? (
            <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
              {observedRows.map((row, index) => (
                <ObservedCallRow key={row.key} row={row} index={index} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-24 flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
              {noDataMessage}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
