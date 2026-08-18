import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { getReportsQuery } from "../modules/reports/query";

// The page component lives in reports.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/reports")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: ({ deps }) =>
    getReportsQuery({ data: deps.locale }).then((data) => ({
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
});
