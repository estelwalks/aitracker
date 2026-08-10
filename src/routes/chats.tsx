import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { getSessionsQuery, SessionsPage } from "../modules/sessions/query";

/**
 * Canonical prototype route. `/sessions` remains available for existing links
 * and bookmarks, while both routes use the same real session read model.
 */
export const Route = createFileRoute("/chats")({
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
  component: ChatsRoutePage,
});

function ChatsRoutePage() {
  return <SessionsPage initial={Route.useLoaderData()} />;
}
