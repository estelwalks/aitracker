import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../modules/dashboard/presentation/DashboardPage";
import { getDashboardReadModel } from "../modules/dashboard/query";
import type { DashboardReadModel } from "../modules/dashboard/contracts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";

export const Route = createFileRoute("/")({
  loader: async ({ location }): Promise<DashboardReadModel> =>
    getDashboardReadModel({
      data: resolveLocaleFromSearch(location.search),
    }),
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
