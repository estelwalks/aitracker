import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { getSessionsQuery } from "../modules/sessions/query/api.server";
import { SessionsPage } from "../modules/sessions/query/presentation";

export const Route = createFileRoute("/sessions")({
  loader: ({ location }) =>
    getSessionsQuery().then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.sessions",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "sessions.metaDescription",
        ),
      },
    ],
  }),
  component: SessionsRoutePage,
});

function SessionsRoutePage() {
  return <SessionsPage initial={Route.useLoaderData()} />;
}
