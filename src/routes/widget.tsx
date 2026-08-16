import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { WidgetPage } from "../modules/widget/presentation/WidgetPage";

export const Route = createFileRoute("/widget")({
  loader: async ({ location }) => ({
    locale: resolveLocaleFromSearch(location.search),
  }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.widget",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "widget.metaDescription",
          brandParams,
        ),
      },
    ],
  }),
  component: WidgetRoutePage,
});

function WidgetRoutePage() {
  return <WidgetPage />;
}
