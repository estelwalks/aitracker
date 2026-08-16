import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { getReportsQuery, ReportsPage } from "../modules/reports/query";

export const Route = createFileRoute("/reports")({
  loader: ({ location }) =>
    getReportsQuery({
      data: resolveLocaleFromSearch(location.search),
    }).then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.reports",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "common.reports.pageDesc",
        ),
      },
    ],
  }),
  component: ReportsRoutePage,
});

function ReportsRoutePage() {
  const data = Route.useLoaderData();
  return <ReportsPage initial={data.viewModel} />;
}
