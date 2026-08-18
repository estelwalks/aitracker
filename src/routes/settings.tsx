import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { brandParams } from "../lib/app-config";
import { getStorageUsageQuery } from "../modules/settings";

// The page component lives in settings.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/settings")({
  loader: async ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const section =
      search.section === "scan"
        ? "scan"
        : search.section === "model"
          ? "model"
          : undefined;
    try {
      const usage = await getStorageUsageQuery();
      return {
        locale: resolveLocaleFromSearch(search),
        section,
        storageUsage: usage,
        storageError: null,
      };
    } catch (error) {
      return {
        locale: resolveLocaleFromSearch(search),
        section,
        storageUsage: null,
        storageError:
          error instanceof Error
            ? error.message
            : getMessage(catalogs["zh-CN"], "errors.generic"),
      };
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.settings",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "settings.pageHeaderDesc",
        ),
      },
    ],
  }),
});
