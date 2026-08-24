import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import { getMarketSkills } from "../modules/skill-distribution/query";
import type { MarketListResult } from "../modules/skill-distribution/query";

interface MarketLoader extends MarketListResult {
  readonly locale: Locale;
}

// The page component lives in market.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/market")({
  loader: async ({ location }): Promise<MarketLoader> => {
    const locale = resolveLocaleFromSearch(location.search);
    let market: Awaited<ReturnType<typeof getMarketSkills>>;
    try {
      market = await getMarketSkills({
        data: { page: 1, limit: 12, search: "", sort: "stars" },
      });
    } catch {
      // The market is an optional network integration. A cold/offline desktop
      // must still render the page shell and its local empty state instead of
      // turning a transient timeout into an SSR 500.
      market = {
        skills: [],
        pagination: { page: 1, limit: 12, total: 0, pages: 1 },
        source: "cache",
        fetchedAt: new Date().toISOString(),
        warning: null,
        stats: {
          totalSkills: 0,
          installedCount: 0,
        },
      };
    }
    return { locale, ...market };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.market",
        ),
      },
    ],
  }),
});
