import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";

interface WidgetSearchParams {
  /** Electron 浮窗加载本页时传入：只渲染浮窗面板，不带 PageBar/三个 Section。 */
  readonly mode?: "float" | null;
}

// The page component lives in widget.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/widget")({
  validateSearch: (search: Record<string, unknown>): WidgetSearchParams => ({
    mode: search.mode === "float" ? "float" : null,
  }),
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
    mode: (search as Record<string, unknown>).mode === "float" ? "float" : null,
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
});
