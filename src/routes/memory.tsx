import { createFileRoute } from "@tanstack/react-router";

import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { MemoryPage } from "../modules/knowledge/presentation/MemoryPage";

export const Route = createFileRoute("/memory")({
  loader: async ({ location }) => ({
    locale: resolveLocaleFromSearch(location.search),
  }),
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
  component: MemoryRoutePage,
});

function MemoryRoutePage() {
  return <MemoryPage />;
}
