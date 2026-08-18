import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
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
    const market = await getMarketSkills({
      data: { page: 1, limit: 12, search: "", sort: "downloads" },
    });
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
