import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../modules/dashboard/presentation/DashboardPage";
import { getDashboardSummaryReadModel } from "../modules/dashboard/summary-query";
import type { DashboardSummaryReadModel } from "../modules/dashboard/summary-contracts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { brandParams } from "../lib/app-config";

export const Route = createFileRoute("/")({
  // P4-T4-07: locale is part of the loader cache key; cached navigations reuse
  // the projection while the snapshot revision is unchanged.
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }): Promise<DashboardSummaryReadModel> =>
    getDashboardSummaryReadModel({ data: deps.locale }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.dashboard",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "dashboard.meta.description",
          brandParams,
        ),
      },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return <DashboardPage data={Route.useLoaderData()} />;
}
