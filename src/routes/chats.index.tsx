import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config.ts";
import { resolveLocaleFromSearch } from "../lib/i18n/locale.ts";
import { catalogs, getMessage } from "../lib/i18n/route-messages.ts";
import { getSessionsQuery } from "../modules/sessions/query.ts";

/** Deep-link-only session index; the prototype side navigation has no entry. */
// The page component lives in chats.index.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/chats/")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }) => {
    const page = await getSessionsQuery({
      data: { filter: { range: "30d" } },
    });
    return { ...page, locale: deps.locale };
  },
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 30_000,
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
});
