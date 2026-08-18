import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "../../lib/i18n/locale.ts";
import type { DashboardQuery } from "./contracts.ts";

/** Browser-safe RPC adapter for the dashboard server query. */
export const getDashboardReadModel = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DashboardQuery> => {
    const { loadDashboardReadModel } = await import("./api.server.ts");
    return loadDashboardReadModel(data);
  });
