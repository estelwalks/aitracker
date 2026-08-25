import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { brandParams } from "../lib/app-config";
import {
  getStorageUsageQuery,
  parseSettingsSection,
} from "../modules/settings";

// The page component lives in settings.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/settings")({
  loader: async ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const section = parseSettingsSection(search.section);
    const locale = resolveLocaleFromSearch(search);
    try {
      const usage = await getStorageUsageQuery();
      return {
        locale,
        section,
        storageUsage: usage,
        storageError: null,
      };
    } catch {
      return {
        locale,
        section,
        storageUsage: null,
        storageError: getMessage(catalogs[locale], "errors.generic"),
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
