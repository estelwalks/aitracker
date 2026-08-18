import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { getSourcesQuery } from "../modules/sources/query/presentation";

// The page component lives in sources.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/sources")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: ({ deps }) =>
    getSourcesQuery().then((data) => ({
      ...data,
      locale: deps.locale,
    })),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.sources",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "sources.metaDescription",
        ),
      },
    ],
  }),
});
