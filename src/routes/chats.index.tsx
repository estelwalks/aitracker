import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config.ts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale.ts";
import { catalogs, getMessage } from "../lib/i18n/messages.ts";
import { SessionsPage } from "../modules/sessions/presentation/SessionsPage.tsx";
import { getSessionsQuery } from "../modules/sessions/query.ts";

/** Deep-link-only session index; the prototype side navigation has no entry. */
export const Route = createFileRoute("/chats/")({
  loader: async ({ location }) => {
    const locale = resolveLocaleFromSearch(location.search);
    const page = await getSessionsQuery({ data: {} });
    return { ...page, locale };
  },
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
  component: ChatsIndexRoute,
});

function ChatsIndexRoute() {
  return <SessionsPage initial={Route.useLoaderData()} />;
}
