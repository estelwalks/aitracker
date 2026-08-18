import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "../../lib/i18n/locale.ts";

/**
 * P4-T4-05/06: compact Widget read model RPCs (browser-safe definitions).
 *
 * The server pre-aggregates the four standard periods (today / 7d / 30d / all)
 * from the dashboard summary, so the widget never receives raw events and
 * never re-aggregates. The status read is a ≤2 KB `{ revision, status }`
 * probe; the widget only fetches the ≤50 KB model when the revision changes.
 */

export interface WidgetToolStat {
  readonly id: string;
  readonly name: string;
  readonly tokens: number;
  readonly events: number;
  readonly costUsd: number | null;
}

export interface WidgetPeriodStats {
  readonly tokens: number;
  readonly events: number;
  readonly sessions: number | null;
  readonly activeTools: number;
  readonly costUsd: number | null;
  readonly cacheRate: number | null;
  readonly trend: readonly { date: string; tokens: number }[];
  readonly topTools: readonly WidgetToolStat[];
}

export interface WidgetReadModel {
  readonly revision: string;
  readonly generatedAt: string | null;
  readonly hasData: boolean;
  readonly today: WidgetPeriodStats;
  readonly week: WidgetPeriodStats;
  readonly month: WidgetPeriodStats;
  readonly total: WidgetPeriodStats;
  readonly outputs: {
    readonly distilled: number | null;
    readonly reports: number | null;
  };
}

export interface WidgetStatusReadModel {
  readonly revision: string | null;
  readonly status: "empty" | "fresh" | "stale" | "failed" | "refreshing";
  readonly generatedAt: string | null;
}

export const getWidgetStatusReadModel = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<WidgetStatusReadModel> => {
    const { loadWidgetStatus } = await import("./read-model.server.ts");
    return loadWidgetStatus(data);
  });

export const getWidgetReadModel = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<WidgetReadModel> => {
    const { loadWidgetReadModel } = await import("./read-model.server.ts");
    return loadWidgetReadModel(data);
  });
