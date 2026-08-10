/**
 * Reports query transport bridge. Re-exports the server loader and the page
 * component so routes can import a single entry point
 * (`../modules/reports/query`), mirroring the sessions/sources pattern.
 */
import type { Locale } from "../../lib/i18n/locale";
import type { LoadReportsResult } from "./api.server";

export { ReportsPage } from "./presentation/ReportsPage.tsx";

/**
 * Resolve the reports read model on the server. Accepts the resolved locale
 * for transport parity; the current view model is locale-neutral. Route
 * loaders spread the result and add `locale`.
 */
export async function getReportsQuery(
  locale: Locale = "zh-CN",
): Promise<LoadReportsResult> {
  const { loadReports } = await import("./api.server.ts");
  return loadReports(locale);
}
