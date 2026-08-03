import { useMemo, useState } from "react";
import { Segmented } from "../tt";
import {
  estimateUsageCost,
  formatCost,
  type CostEstimate,
} from "../../lib/pricing";
import {
  aggregateUsageBySession,
  breakdownComposition,
  cacheRate,
  formatTokens,
  shareOf,
} from "../../lib/local-usage/presentation";
import type {
  LocalUsageBreakdown,
  LocalUsageEvent,
  LocalUsageTotals,
} from "../../lib/local-usage";

const MAX_ROWS = 30;

type DetailDimension = "date" | "model";

interface DetailRow {
  key: string;
  totalTokens: number;
  cost: CostEstimate;
  share: number;
  cacheHitRate: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  sessions: number;
  composition: ReturnType<typeof breakdownComposition>;
}

const EMPTY_TOTALS: LocalUsageTotals = {
  events: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

/**
 * FR-007 - Consumption detail table with 按日/按模型 dimension toggle.
 *
 * Each row aggregates events by the chosen dimension and shows total tokens,
 * cost, share (with progress bar), cache hit rate, input/output/reasoning
 * token breakdown, distinct session count, and an inline composition bar.
 * Sticky header, scrollable body, max 30 rows with a footer counter.
 */
export function UsageDetailTable({ events }: { events: LocalUsageEvent[] }) {
  const [dimension, setDimension] = useState<DetailDimension>("date");

  const rows = useMemo(
    () => buildDetailRows(events, dimension),
    [events, dimension],
  );

  const totalRows = rows.length;
  const displayRows = rows.slice(0, MAX_ROWS);
  const grandTotal = rows.reduce((sum, r) => sum + r.totalTokens, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between">
        <span className="tt-num text-[11px] text-muted-foreground">
          {totalRows > 0
            ? `${totalRows} 项 · ${formatTokens(grandTotal)}`
            : "暂无明细数据"}
        </span>
        <Segmented
          value={dimension}
          onChange={(v) => setDimension(v as DetailDimension)}
          options={[
            { value: "date", label: "按日" },
            { value: "model", label: "按模型" },
          ]}
        />
      </div>

      {totalRows === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 py-8 text-center text-xs text-muted-foreground">
          当前区间暂无消耗明细。
        </div>
      ) : (
        <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                <th className="px-3 py-2.5 font-normal">名称</th>
                <th className="px-3 py-2.5 text-right font-normal">
                  消耗 Token
                </th>
                <th className="px-3 py-2.5 text-right font-normal">费用</th>
                <th className="px-3 py-2.5 text-right font-normal">占比</th>
                <th className="px-3 py-2.5 text-right font-normal">缓存命中</th>
                <th className="px-3 py-2.5 text-right font-normal">输入</th>
                <th className="px-3 py-2.5 text-right font-normal">输出</th>
                <th className="px-3 py-2.5 text-right font-normal">推理</th>
                <th className="px-3 py-2.5 text-right font-normal">会话</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={row.key}
                  className="border-b border-border/60 last:border-0 hover:bg-accent/40"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      <span
                        className="max-w-48 truncate font-medium"
                        title={row.key}
                      >
                        {row.key}
                      </span>
                      {row.composition.length > 1 && (
                        <div className="flex h-1 w-28 overflow-hidden rounded-full">
                          {row.composition.map((seg, i) => (
                            <span
                              key={i}
                              className="block h-full"
                              style={{
                                width: `${shareOf(seg.value, row.totalTokens)}%`,
                                background: seg.color,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right">
                    {formatTokens(row.totalTokens)}
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right">
                    {formatCost(row.cost, "CNY")}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-2">
                      {row.share > 0 && (
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border/40">
                          <div
                            className="h-full rounded-full bg-primary/60"
                            style={{
                              width: `${Math.min(row.share, 100)}%`,
                            }}
                          />
                        </div>
                      )}
                      <span className="tt-num tabular-nums w-10 text-right text-muted-foreground">
                        {row.share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right text-muted-foreground">
                    {row.cacheHitRate.toFixed(0)}%
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right">
                    {formatTokens(row.inputTokens)}
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right">
                    {formatTokens(row.outputTokens)}
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right">
                    {formatTokens(row.reasoningOutputTokens)}
                  </td>
                  <td className="tt-num tabular-nums px-3 py-2.5 text-right text-muted-foreground">
                    {row.sessions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="tt-num border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            当前展示 {Math.min(totalRows, MAX_ROWS)} 条 / 共 {totalRows} 条
          </div>
        </div>
      )}
    </div>
  );
}

function buildDetailRows(
  events: LocalUsageEvent[],
  dimension: DetailDimension,
): DetailRow[] {
  const groups = new Map<string, LocalUsageEvent[]>();
  for (const event of events) {
    const key =
      dimension === "date" ? event.timestamp.slice(0, 10) : event.model;
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }

  const rows: DetailRow[] = [];
  for (const [key, groupEvents] of groups) {
    const totals = groupEvents.reduce<LocalUsageTotals>(
      (acc, e) => {
        acc.events += 1;
        acc.inputTokens += e.inputTokens;
        acc.cachedInputTokens += e.cachedInputTokens;
        acc.cacheCreationInputTokens += e.cacheCreationInputTokens;
        acc.outputTokens += e.outputTokens;
        acc.reasoningOutputTokens += e.reasoningOutputTokens;
        acc.totalTokens += e.totalTokens;
        return acc;
      },
      { ...EMPTY_TOTALS },
    );

    const cost = estimateUsageCost(groupEvents);
    const sessionSummary = aggregateUsageBySession(groupEvents);
    const breakdown = breakdownComposition({
      key,
      ...totals,
    } as LocalUsageBreakdown);

    rows.push({
      key,
      totalTokens: totals.totalTokens,
      cost,
      share: 0,
      cacheHitRate: cacheRate(totals),
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      reasoningOutputTokens: totals.reasoningOutputTokens,
      sessions: sessionSummary.rows.length,
      composition: breakdown,
    });
  }

  if (dimension === "date") {
    rows.sort((a, b) => a.key.localeCompare(b.key));
  } else {
    rows.sort((a, b) => b.totalTokens - a.totalTokens);
  }

  const grandTotal = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  for (const row of rows) {
    row.share = shareOf(row.totalTokens, grandTotal);
  }

  return rows;
}
