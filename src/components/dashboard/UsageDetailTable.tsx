import { useMemo, useState } from "react";
import { Segmented } from "../aitracker";
import { useI18n } from "../../lib/i18n/context";
import type { MessageKey } from "../../lib/i18n/messages";
import { estimateUsageCost, type CostEstimate } from "../../lib/pricing";
import { formatCostLabel } from "../../lib/pricing/cost-label";
import {
  aggregateUsageBySession,
  breakdownComposition,
  cacheRate,
  shareOf,
} from "../../lib/local-usage/presentation";
import type {
  LocalUsageBreakdown,
  LocalUsageEvent,
  LocalUsageTotals,
} from "../../lib/local-usage";

const MAX_ROWS = 30;

type DetailDimension = "date" | "model" | "project";

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
  const { t, format } = useI18n();
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
        <span className="aitracker-num text-[11px] text-muted-foreground">
          {totalRows > 0
            ? `${t("dashboard.detail.items", { count: totalRows })} · ${format.formatTokens(grandTotal)}`
            : t("dashboard.detail.empty")}
        </span>
        <Segmented
          value={dimension}
          onChange={(v) => setDimension(v as DetailDimension)}
          options={[
            { value: "date", label: t("dashboard.detail.dimensionDate") },
            { value: "model", label: t("dashboard.detail.dimensionModel") },
            { value: "project", label: t("dashboard.detail.dimensionProject") },
          ]}
        />
      </div>

      {totalRows === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 py-8 text-center text-xs text-muted-foreground">
          {t("dashboard.detail.emptyRange")}
        </div>
      ) : (
        <div className="aitracker-xscroll min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[920px] text-[13px]">
            <thead className="sticky top-0 z-10 bg-surface-1">
              <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                <th className="px-3 py-2.5 font-normal">
                  {t("dashboard.detail.name")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.detail.tokensUsed")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.detail.cost")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.detail.share")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.detail.cacheHit")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.tokens.input")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.tokens.output")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.tokens.reasoning")}
                </th>
                <th className="px-3 py-2.5 text-right font-normal">
                  {t("dashboard.detail.sessions")}
                </th>
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
                        <div className="flex h-[5px] w-full max-w-36 overflow-hidden rounded-[2px] bg-surface-2">
                          {row.composition.map((seg, i) => (
                            <span
                              key={i}
                              className="block h-full"
                              title={`${t(seg.label as MessageKey)} ${format.formatTokens(seg.value)} · ${shareOf(seg.value, row.totalTokens).toFixed(1)}%`}
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
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right">
                    {format.formatTokens(row.totalTokens)}
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right">
                    {formatCostLabel(t, format, row.cost)}
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
                      <span className="aitracker-num tabular-nums w-10 text-right text-muted-foreground">
                        {row.share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right text-muted-foreground">
                    {row.cacheHitRate.toFixed(0)}%
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right">
                    {format.formatTokens(row.inputTokens)}
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right">
                    {format.formatTokens(row.outputTokens)}
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right">
                    {format.formatTokens(row.reasoningOutputTokens)}
                  </td>
                  <td className="aitracker-num tabular-nums px-3 py-2.5 text-right text-muted-foreground">
                    {row.sessions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="aitracker-num border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            {t("dashboard.detail.showing", {
              shown: Math.min(totalRows, MAX_ROWS),
              total: totalRows,
            })}
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
      dimension === "date"
        ? event.timestamp.slice(0, 10)
        : dimension === "model"
          ? event.model
          : event.project;
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
