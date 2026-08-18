import { createServerFn } from "@tanstack/react-start";

import type { Locale } from "../../lib/i18n/locale.ts";
import type { DashboardAIInsightView } from "./contracts.ts";

/**
 * Explicit refresh boundary for the dashboard LLM insight. Route loaders use
 * the cache-only read path; this POST action is the only browser-reachable
 * code path that can make a provider request.
 */
export const refreshDashboardAIInsight = createServerFn({ method: "POST" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DashboardAIInsightView> => {
    const [{ loadDashboardReadModel }, insight] = await Promise.all([
      import("./api.server.ts"),
      import("./ai-insight.server.ts"),
    ]);
    // The regular loader only reads the old cache; it does not create a model
    // request. Its V2 snapshot and monitoring DTO are already privacy-safe
    // aggregate inputs for the server-only allowlist builder.
    const dashboard = await loadDashboardReadModel(data);
    return insight.getDashboardAIInsightService().refresh(
      insight.toDashboardAIInsightInput({
        snapshot: dashboard.v2,
        monitoring: dashboard.monitoring,
      }),
    );
  });
