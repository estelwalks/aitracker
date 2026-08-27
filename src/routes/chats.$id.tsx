import { createFileRoute, notFound } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config.ts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale.ts";
import { catalogs, getMessage } from "../lib/i18n/route-messages.ts";
import { getSessionDetailQuery } from "../modules/sessions/query.ts";

type ChatDetailSearch = {
  source?: string;
  locale?: string;
};

// The page component lives in chats.$id.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/chats/$id")({
  validateSearch: (search: Record<string, unknown>): ChatDetailSearch => ({
    source:
      typeof search.source === "string" &&
      /^[a-z][a-z0-9-]{0,79}$/u.test(search.source)
        ? search.source
        : undefined,
    locale: typeof search.locale === "string" ? search.locale : undefined,
  }),
  loader: async ({ params, location }) => {
    const search = location.search as Record<string, unknown>;
    const session = await getSessionDetailQuery({
      data: { sessionId: params.id },
    });
    if (session == null) throw notFound();
    return {
      session,
      source: typeof search.source === "string" ? search.source : undefined,
      locale: resolveLocaleFromSearch(search),
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
});
