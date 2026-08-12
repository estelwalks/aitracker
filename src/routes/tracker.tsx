import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import type { TrackerReadModel } from "../modules/usage/contracts";
import { getTrackerQuery } from "../modules/usage/query";
import { TrackerPage } from "../modules/usage/presentation/TrackerPage";

interface TrackerLoader {
  readonly locale: Locale;
  readonly model: TrackerReadModel;
}

export const Route = createFileRoute("/tracker")({
  loader: async ({ location }): Promise<TrackerLoader> => {
    const locale = resolveLocaleFromSearch(location.search);
    const model = await getTrackerQuery();
    return { locale, model };
  },
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
  component: TrackerRoutePage,
});

function TrackerRoutePage() {
  const { model } = Route.useLoaderData();
  return <TrackerPage initial={model} />;
}
