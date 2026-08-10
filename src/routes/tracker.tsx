import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { DashboardReadModel } from "../modules/dashboard/contracts";
import { DashboardPage } from "../modules/dashboard/presentation/DashboardPage";
import { getDashboardReadModel } from "../modules/dashboard/query";

/**
 * The tracker route intentionally reuses the dashboard's server read model.
 * It is a real usage view (not a static market mock) and keeps the prototype
 * URL stable until the tracker receives a dedicated read model.
 */
export const Route = createFileRoute("/tracker")({
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
  component: TrackerRoutePage,
});

function TrackerRoutePage() {
  return <DashboardPage data={Route.useLoaderData()} />;
}
