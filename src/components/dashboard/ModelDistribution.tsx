import { useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Segmented } from "../tt";
import {
  aggregatePricedUsage,
  estimateUsageCost,
  formatMoney,
  type PricedUsageRow,
} from "../../lib/pricing";
import { formatCostLabel } from "../../lib/pricing/cost-label";
import { shareOf } from "../../lib/local-usage/presentation";
import { useI18n } from "../../lib/i18n/context";
import type { LocalUsageEvent } from "../../lib/local-usage";

const chartColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

type ModelView = "donut" | "bars" | "list";

/**
 * FR-010 — Model distribution with donut/bar/list toggle. Each model shows
 * name, token count, cost and share %. Sorted by token desc. List view shows
 * all models in a scrollable area; chart views show top N with an "其他"
 * bucket rolled up so the chart stays legible when there are many models.
 */
export interface ModelDistributionProps {
  events: LocalUsageEvent[];
}

export function ModelDistribution({ events }: ModelDistributionProps) {
  const { locale, t, format } = useI18n();
  const [view, setView] = useState<ModelView>("donut");

  const segmentOptions = [
    { value: "donut", label: t("dashboard.model.viewDonut") },
    { value: "bars", label: t("dashboard.model.viewBars") },
    { value: "list", label: t("dashboard.model.viewList") },
  ];

  const models: (PricedUsageRow & {
    share: number;
    color: string;
  })[] = useMemo(() => {
    const rows = aggregatePricedUsage(events, "model").filter(
      (row) => row.totalTokens > 0,
    );
    const total = rows.reduce((sum, row) => sum + row.totalTokens, 0);
    return rows.map((row, index) => ({
      ...row,
      share: shareOf(row.totalTokens, total),
      color: chartColors[index % chartColors.length]!,
    }));
  }, [events]);

  const totalTokens = models.reduce((sum, model) => sum + model.totalTokens, 0);
  const totalCost = useMemo(() => estimateUsageCost(events), [events]);

  if (models.length === 0) {
    return (
      <div className="flex flex-col" style={{ minHeight: 160 }}>
        <div className="mb-2 flex items-center justify-end">
          <Segmented
            value={view}
            onChange={(value) => setView(value as ModelView)}
            options={segmentOptions}
          />
        </div>
        <div className="flex flex-1 items-center justify-center rounded-sm border border-dashed border-border-strong px-4 text-center text-xs text-muted-foreground">
          {t("dashboard.model.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ minHeight: 160, maxHeight: 360 }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="tt-num text-[11px] text-muted-foreground">
          {t("dashboard.model.summary", {
            count: models.length,
            tokens: format.formatTokens(totalTokens),
            cost: formatCostLabel(t, format, totalCost),
          })}
        </span>
        <Segmented
          value={view}
          onChange={(value) => setView(value as ModelView)}
          options={segmentOptions}
        />
      </div>
      {view === "donut" && (
        <ModelDonut models={models} totalTokens={totalTokens} />
      )}
      {view === "bars" && (
        <ModelBars models={models} totalTokens={totalTokens} />
      )}
      {view === "list" && (
        <ModelList models={models} totalTokens={totalTokens} />
      )}
    </div>
  );
}

const TOP_N = 6;

function ModelDonut({
  models,
  totalTokens,
}: {
  models: (PricedUsageRow & { share: number; color: string })[];
  totalTokens: number;
}) {
  const { locale, t, format } = useI18n();
  const top = models.slice(0, TOP_N);
  const rest = models.slice(TOP_N);
  const restTokens = rest.reduce((sum, m) => sum + m.totalTokens, 0);
  const restCost = rest.reduce((sum, m) => sum + m.cost.knownUsd, 0);
  const otherLabel = t("dashboard.model.other");
  const chartData = [
    ...top.map((m) => ({
      name: m.key,
      tokens: m.totalTokens,
      color: m.color,
    })),
    ...(restTokens > 0
      ? [
          {
            name: otherLabel,
            tokens: restTokens,
            color: "var(--color-muted-foreground)",
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <div className="relative" style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="tokens"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              stroke="var(--color-surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, _name, entry) => {
                const tokens = Number(value);
                const share =
                  totalTokens > 0 ? shareOf(tokens, totalTokens) : 0;
                const name = String(entry?.payload?.name ?? "");
                const model = top.find((m) => m.key === name);
                const costUsd = model
                  ? model.cost.knownUsd
                  : name === otherLabel
                    ? restCost
                    : 0;
                return [
                  `${format.formatTokens(tokens)} · ${format.formatPercent(share)} · ${format.formatUsd(costUsd)}`,
                  name,
                ];
              }}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 4,
                fontSize: 11,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="dashboard-donut-label">
          <strong>{models.length}</strong>
          <span>{t("dashboard.model.modelsLabel")}</span>
        </div>
      </div>
      <ModelLegend models={top} rest={rest} totalTokens={totalTokens} />
    </div>
  );
}

function ModelBars({
  models,
  totalTokens,
}: {
  models: (PricedUsageRow & { share: number; color: string })[];
  totalTokens: number;
}) {
  const { t, format } = useI18n();
  const top = models.slice(0, TOP_N);
  const rest = models.slice(TOP_N);
  const restTokens = rest.reduce((sum, m) => sum + m.totalTokens, 0);
  const otherLabel = t("dashboard.model.other");
  const data = [
    ...top.map((m) => ({
      name: shortModel(m.key),
      tokens: m.totalTokens,
      color: m.color,
    })),
    ...(restTokens > 0
      ? [
          {
            name: otherLabel,
            tokens: restTokens,
            color: "var(--color-muted-foreground)",
          },
        ]
      : []),
  ];
  return (
    <div className="flex flex-col gap-2">
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={84}
              tick={{
                fontSize: 10,
                fill: "var(--color-muted-foreground)",
              }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(value, _name, entry) => {
                const tokens = Number(value);
                const share =
                  totalTokens > 0 ? shareOf(tokens, totalTokens) : 0;
                return [
                  `${format.formatTokens(tokens)} · ${format.formatPercent(share)}`,
                  String(entry?.payload?.name ?? ""),
                ];
              }}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 4,
                fontSize: 11,
              }}
            />
            <Bar dataKey="tokens" isAnimationActive={false} maxBarSize={14}>
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ModelLegend models={top} rest={rest} totalTokens={totalTokens} />
    </div>
  );
}

function ModelList({
  models,
  totalTokens,
}: {
  models: (PricedUsageRow & { share: number; color: string })[];
  totalTokens: number;
}) {
  const { t, format } = useI18n();
  return (
    <div className="tt-xscroll min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-[360px] text-[11px]">
        <thead className="sticky top-0 bg-surface-1">
          <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
            <th className="px-2 py-1.5 font-normal">
              {t("dashboard.model.colModel")}
            </th>
            <th className="px-2 py-1.5 text-right font-normal">
              {t("dashboard.model.colTokens")}
            </th>
            <th className="px-2 py-1.5 text-right font-normal">
              {t("dashboard.detail.cost")}
            </th>
            <th className="px-2 py-1.5 text-right font-normal">
              {t("dashboard.detail.share")}
            </th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => (
            <tr
              key={model.key}
              className="border-b border-border/60 last:border-0"
            >
              <td className="max-w-44 truncate px-2 py-1.5" title={model.key}>
                <span
                  className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                  style={{ background: model.color }}
                />
                {model.key}
              </td>
              <td className="tt-num px-2 py-1.5 text-right">
                {format.formatTokens(model.totalTokens)}
              </td>
              <td className="tt-num px-2 py-1.5 text-right">
                {formatCostLabel(t, format, model.cost)}
              </td>
              <td className="tt-num px-2 py-1.5 text-right text-muted-foreground">
                {format.formatPercent(model.share)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tt-num mt-1 px-2 py-1 text-[10px] text-muted-foreground">
        {t("dashboard.model.total", {
          tokens: format.formatTokens(totalTokens),
        })}
      </div>
    </div>
  );
}

function ModelLegend({
  models,
  rest,
  totalTokens,
}: {
  models: (PricedUsageRow & { share: number; color: string })[];
  rest: (PricedUsageRow & { share: number; color: string })[];
  totalTokens: number;
}) {
  const { t, format } = useI18n();
  const restTokens = rest.reduce((sum, m) => sum + m.totalTokens, 0);
  const restShare = totalTokens > 0 ? shareOf(restTokens, totalTokens) : 0;
  return (
    <div className="grid gap-1 text-[10px]">
      {models.map((model) => (
        <div key={model.key} className="flex items-center gap-2">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: model.color }}
          />
          <span className="truncate" title={model.key}>
            {model.key}
          </span>
          <span className="tt-num ml-auto">
            {format.formatTokens(model.totalTokens)}
          </span>
          <span className="tt-num w-10 text-right text-muted-foreground">
            {format.formatPercent(model.share)}
          </span>
        </div>
      ))}
      {restTokens > 0 && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: "var(--color-muted-foreground)" }}
          />
          <span>{t("dashboard.model.otherCount", { count: rest.length })}</span>
          <span className="tt-num ml-auto">
            {format.formatTokens(restTokens)}
          </span>
          <span className="tt-num w-10 text-right">
            {format.formatPercent(restShare)}
          </span>
        </div>
      )}
    </div>
  );
}

function shortModel(name: string): string {
  // Keep the chart's category axis legible — long model ids get truncated
  // with an ellipsis. The full name is shown in the legend below the chart.
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}
