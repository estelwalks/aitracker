import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../errors";
import { LOCALES, type Locale } from "../i18n/locale";
import {
  PAGE_INSIGHTS_IDS,
  type PageInsightsPage,
  type PageInsightsResult,
} from "./types";

export interface GetPageInsightsInput {
  readonly page: PageInsightsPage;
  readonly locale: Locale;
}

export const pageInsightsValidator = (input: unknown): GetPageInsightsInput => {
  const value = input as GetPageInsightsInput | null | undefined;
  if (
    value == null ||
    !PAGE_INSIGHTS_IDS.includes(value.page) ||
    !(LOCALES as readonly string[]).includes(value.locale)
  ) {
    throw new AppError("errors.generic");
  }
  return { page: value.page, locale: value.locale };
};

/**
 * Page-scoped Jarvis insight lines built from real read models (sources /
 * tracker today; distill / reports / skills reserved for other tasks). The
 * heavy data loaders are imported dynamically server-side.
 */
export const getPageInsights = createServerFn({ method: "GET" })
  .validator(pageInsightsValidator)
  .handler(async ({ data }): Promise<PageInsightsResult> => {
    const { buildPageInsights } = await import("./insights.server.ts");
    return buildPageInsights(data.page, data.locale);
  });
