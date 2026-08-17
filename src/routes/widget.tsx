import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { JarvisWidget } from "../modules/widget/presentation/JarvisWidget";
import { WidgetPage } from "../modules/widget/presentation/WidgetPage";

interface WidgetSearchParams {
  /** Electron 浮窗加载本页时传入：只渲染浮窗面板，不带 PageBar/三个 Section。 */
  readonly mode?: "float" | null;
}

export const Route = createFileRoute("/widget")({
  validateSearch: (search: Record<string, unknown>): WidgetSearchParams => ({
    mode: search.mode === "float" ? "float" : null,
  }),
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
  const { mode } = Route.useSearch();
  if (mode === "float") {
    return (
      <div className="tt-xscroll py-1">
        <JarvisWidget className="mx-auto" />
      </div>
    );
  }
  return <WidgetPage />;
}
