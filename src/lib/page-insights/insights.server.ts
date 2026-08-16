/**
 * Server-only loader for `getPageInsights`. Heavy read-model modules are
 * imported dynamically so they never reach the browser bundle (the same
 * `*.server.ts` convention used across the feature modules).
 */
import type { Locale } from "../i18n/locale";
import { composeSourcesInsights, composeTrackerInsights } from "./compose";
import type { PageInsightsPage, PageInsightsResult } from "./types";

export async function buildPageInsights(
  page: PageInsightsPage,
  locale: Locale,
): Promise<PageInsightsResult> {
  const generatedAt = new Date().toISOString();
  switch (page) {
    case "sources": {
      const { getSourcesQuery } =
        await import("../../modules/sources/query/api.server");
      const summary = await getSourcesQuery();
      return {
        generatedAt,
        page,
        lines: composeSourcesInsights(summary, locale),
      };
    }
    case "tracker": {
      const { loadTrackerReadModel } =
        await import("../../modules/usage/api.server");
      const model = await loadTrackerReadModel();
      return {
        generatedAt,
        page,
        lines: composeTrackerInsights(model, locale),
      };
    }
    default:
      // distill / reports / skills are owned by other tasks — no lines yet.
      return { generatedAt, page, lines: [] };
  }
}
