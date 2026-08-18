import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import type { TrackerReadModel } from "../modules/usage/contracts";
import { getTrackerQuery } from "../modules/usage/query";

interface TrackerLoader {
  readonly locale: Locale;
  readonly model: TrackerReadModel;
}

// The page component lives in tracker.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/tracker")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }): Promise<TrackerLoader> => {
    const model = await getTrackerQuery();
    return { locale: deps.locale, model };
  },
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.tracker",
          brandParams,
        ),
      },
    ],
  }),
});
