import { createServerFn } from "@tanstack/react-start";
import type { Locale } from "../../lib/i18n/locale.ts";

/** Browser-safe RPC adapter for the dashboard server query. */
export const getDashboardReadModel = createServerFn({ method: "GET" })
  .inputValidator((value: Locale) => value)
  .handler(async ({ data }) => {
    const { loadDashboardReadModel } = await import("./api.server.ts");
    return loadDashboardReadModel(data);
  });
