import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import type { TrackerReadModel } from "../modules/usage/contracts";
import { getTrackerQuery } from "../modules/usage/query";

interface TrackerLoader {
  readonly locale: Locale;
  readonly model: TrackerReadModel;
}

/** Empty burning-board read model: falls back to an empty board on loader
 * failure instead of crashing the whole page. */
function emptyTrackerReadModel(): TrackerReadModel {
  return {
    generatedAt: null,
    boards: {
      skill: { rows: [] },
      project: { rows: [] },
      session: { rows: [] },
    },
    totals: { tokens: 0, events: 0, entries: 0 },
  };
}

// The page component lives in tracker.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/tracker")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }): Promise<TrackerLoader> => {
    const locale = deps.locale;
    let model: TrackerReadModel;
    try {
      model = await getTrackerQuery();
    } catch {
      // The usage snapshot is optional: a transient collection/lock failure
      // must still render the page shell and its empty state instead of
      // turning into a crash / SSR 500.
      model = emptyTrackerReadModel();
    }
    return { locale, model };
  },
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 30_000,
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
