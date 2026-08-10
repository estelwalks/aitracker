import { createFileRoute } from "@tanstack/react-router";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import {
  getSourcesQuery,
  SourcesPage,
} from "../modules/sources/query/presentation";

export const Route = createFileRoute("/sources")({
  loader: ({ location }) =>
    getSourcesQuery().then((data) => ({
      ...data,
      locale: resolveLocaleFromSearch(location.search),
    })),
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
  component: SourcesRoutePage,
});
function SourcesRoutePage() {
  return <SourcesPage initial={Route.useLoaderData()} />;
}
