import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";

// The page component lives in memory.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/memory")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }) => ({
    locale: deps.locale,
  }),
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.memory",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "memory.metaDescription",
          brandParams,
        ),
      },
    ],
  }),
});
