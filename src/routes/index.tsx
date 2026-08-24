import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../modules/dashboard/presentation/DashboardPage";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { brandParams } from "../lib/app-config";

export const Route = createFileRoute("/")({
  // Keep the route loader synchronous. Dashboard data is intentionally owned
  // by the page query so the shared shell and sidebar can commit immediately.
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: ({ deps }) => deps.locale,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData ?? "zh-CN"],
          "meta.titles.dashboard",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData ?? "zh-CN"],
          "dashboard.meta.description",
          brandParams,
        ),
      },
    ],
  }),
  component: DashboardRoute,
});

function DashboardRoute() {
  return <DashboardPage locale={Route.useLoaderData()} />;
}
