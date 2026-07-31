import type {
  LocalUsageEvent,
  LocalUsageSource,
} from "../local-usage/types.ts";
import type { ProviderBudget } from "../settings/store.ts";
import {
  UsageHeatmap,
  type BudgetIndicator,
} from "../../components/UsageHeatmap.tsx";
import {
  estimateUsageCost,
  filterEventsByPeriod,
  currentUsdToCny,
} from "../pricing/index.ts";
import {
  DAILY_SCAN_LIMIT,
  readDailyScanCount,
} from "../security/daily-limit.ts";

export type { ProviderBudget } from "../settings/store.ts";
export type { BudgetIndicator } from "../../components/UsageHeatmap.tsx";
export type {
  LocalUsageEvent,
  LocalUsageSource,
} from "../local-usage/types.ts";

export type ProviderAwareUsageEvent = LocalUsageEvent & { provider?: unknown };

export function resolveEventProvider(event: ProviderAwareUsageEvent): string {
  if (typeof event.provider === "string" && event.provider.trim()) {
    return event.provider.trim();
  }

  const model = event.model.trim().toLowerCase();
  if (model.includes("claude")) return "Anthropic";
  if (model.includes("gpt") || /(?:^|[/:\s])o\d(?:$|[-_.])/i.test(model))
    return "OpenAI";
  if (model.includes("gemini")) return "Google";
  if (model.includes("deepseek")) return "DeepSeek";
  if (model.includes("kimi") || model.includes("moonshot")) return "Moonshot";
  if (model.includes("grok")) return "xAI";
  return event.source;
}

export interface ProviderBudgetPeriodIndicator extends BudgetIndicator {
  pricedEvents: number;
  unknownEvents: number;
}

export interface ProviderBudgetIndicators {
  provider: string;
  periods: ProviderBudgetPeriodIndicator[];
}

export function buildProviderBudgetIndicators(
  events: ProviderAwareUsageEvent[],
  budgets: ProviderBudget[],
  alertThreshold: number,
  now = new Date(),
): ProviderBudgetIndicators[] {
  return budgets.map((budget) => {
    const providerEvents = events.filter(
      (event) =>
        resolveEventProvider(event).toLowerCase() ===
        budget.provider.toLowerCase(),
    );
    const periods = [
      {
        key: "daily" as const,
        label: "今日",
        period: "today" as const,
        budget: budget.dailyBudget,
      },
      {
        key: "weekly" as const,
        label: "本周",
        period: "week" as const,
        budget: budget.weeklyBudget,
      },
      {
        key: "monthly" as const,
        label: "本月",
        period: "month" as const,
        budget: budget.monthlyBudget,
      },
    ].map((item) => {
      const cost = estimateUsageCost(
        filterEventsByPeriod(providerEvents, item.period, "", "", now),
      );
      const indicator = UsageHeatmap.buildBudgetIndicators(
        [
          {
            key: item.key,
            label: item.label,
            budgetCny: item.budget,
            spentCny: cost.knownUsd * currentUsdToCny(),
            unknownEvents: cost.unknownEvents,
          },
        ],
        alertThreshold,
      )[0]!;
      return {
        ...indicator,
        pricedEvents: cost.pricedEvents,
        unknownEvents: cost.unknownEvents,
      };
    });
    return { provider: budget.provider, periods };
  });
}

export function readRemainingSecurityScans(
  storage?: Pick<Storage, "getItem">,
  now = new Date(),
): number | null {
  if (!storage) return null;
  return Math.max(0, DAILY_SCAN_LIMIT - readDailyScanCount(storage, now));
}
