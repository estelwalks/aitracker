import { createFileRoute } from "@tanstack/react-router";

import { getMarketSkills } from "../modules/skill-distribution/query";
import { MarketPage } from "../modules/market";
import type { MarketListResult } from "../modules/skill-distribution/query";
import { getMessage, catalogs } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { brandParams } from "../lib/app-config";

const PAGE_SIZE = 14;

function emptyResult(): MarketListResult {
  return {
    skills: [],
    pagination: { page: 1, limit: PAGE_SIZE, total: 0, pages: 0 },
    source: "network",
    fetchedAt: new Date(0).toISOString(),
    warning: null,
  };
}

export const Route = createFileRoute("/market")({
  loader: async ({ location }) => {
    const locale = resolveLocaleFromSearch(location.search);
    try {
      return {
        locale,
        result: await getMarketSkills({
          data: { page: 1, limit: PAGE_SIZE, search: "", sort: "downloads" },
        }),
        error: null,
      };
    } catch (error) {
      return {
        locale,
        result: emptyResult(),
        error:
          error instanceof Error
            ? error.message
            : getMessage(catalogs[locale], "market.network.loadFailed"),
      };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.market",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "market.meta.description",
          brandParams,
        ),
      },
    ],
  }),
  component: MarketRoute,
});

function MarketRoute() {
  return <MarketPage initial={Route.useLoaderData()} />;
}
