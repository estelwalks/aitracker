import { createServerFn } from "@tanstack/react-start";
import type { AgentUsageOverviewQueryInput } from "./usage-overview-contracts.ts";
import type { AgentUsageOverviewReadModel } from "./usage-overview-contracts.ts";

/**
 * Browser-safe RPC for the compact agent usage overview (P1-T1-06). The
 * renderer receives only the pre-built view — never raw events.
 */
export const getAgentUsageOverview = createServerFn({ method: "GET" })
  .validator((value: AgentUsageOverviewQueryInput) => {
    if (typeof value?.locale !== "string")
      throw new TypeError("locale required");
    const period = value.period ?? "30d";
    const validPeriods = ["today", "7d", "30d", "all", "custom"];
    if (!validPeriods.includes(period)) throw new TypeError("invalid period");
    if (period === "custom" && (!value.from || !value.to))
      throw new TypeError("custom range requires from/to");
    return {
      locale: value.locale,
      toolId: value.toolId ?? null,
      period,
      from: value.from,
      to: value.to,
    } satisfies AgentUsageOverviewQueryInput;
  })
  .handler(async ({ data }): Promise<AgentUsageOverviewReadModel> => {
    const { loadAgentUsageOverview } =
      await import("./usage-overview-api.server.ts");
    return loadAgentUsageOverview(data);
  });
