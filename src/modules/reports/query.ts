/**
 * Reports query transport bridge. Re-exports the server loader and the page
 * component so routes can import a single entry point
 * (`../modules/reports/query`), mirroring the sessions/dashboard pattern.
 *
 * `getReportsQuery` is a `createServerFn` so that during client-side
 * navigation the loader always executes on the server (the reports read model
 * builds the composition root, which requires Node filesystem access). A plain
 * async loader would run in the browser and leak `node:fs` into the client.
 *
 * `generateReportNow` / `getReportBody` (in `./server-fns.ts`) are the
 * mutation/read server fns the page uses for "立即生成" and inline body preview.
 */
import { createServerFn } from "@tanstack/react-start";

import type { Locale } from "../../lib/i18n/locale";
import type { LoadReportsResult } from "./api.server";

export { ReportsPage } from "./presentation/ReportsPage.tsx";
export { generateReportNow, getReportBody } from "./server-fns.ts";
export type { GenerateReportNowResult } from "./server-fns.ts";

/**
 * Resolve the reports read model on the server. Accepts the resolved locale
 * for transport parity; the current view model is locale-neutral. Route
 * loaders spread the result and add `locale`.
 */
export const getReportsQuery = createServerFn({ method: "GET" })
  .validator((input: unknown): Locale =>
    typeof input === "string" ? (input as Locale) : "zh-CN",
  )
  .handler(async ({ data }): Promise<LoadReportsResult> => {
    const { loadReports } = await import("./api.server.ts");
    return loadReports(data);
  });
