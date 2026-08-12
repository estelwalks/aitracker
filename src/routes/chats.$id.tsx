import { createFileRoute, notFound } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config.ts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale.ts";
import { catalogs, getMessage } from "../lib/i18n/messages.ts";
import { SessionDetailPage } from "../modules/sessions/presentation/SessionDetailPage.tsx";
import { getSessionDetailQuery } from "../modules/sessions/query.ts";

export const Route = createFileRoute("/chats/$id")({
  loader: async ({ params, location }) => {
    const session = await getSessionDetailQuery({
      data: { sessionId: params.id },
    });
    if (session == null) throw notFound();
    return {
      session,
      locale: resolveLocaleFromSearch(location.search),
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.session.title
          ? `${loaderData.session.title.slice(0, 60)} · ${getMessage(
              catalogs[loaderData.locale],
              "meta.titles.sessions",
              brandParams,
            )}`
          : getMessage(
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
  component: ChatDetailRoute,
});

function ChatDetailRoute() {
  return <SessionDetailPage session={Route.useLoaderData().session} />;
}
