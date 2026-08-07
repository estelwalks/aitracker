import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import { brandParams } from "../lib/app-config";
import { getStorageUsageQuery } from "../modules/settings";
import { SettingsPage } from "../modules/settings/presentation";

export const Route = createFileRoute("/settings")({
  loader: async ({ location }) => {
    try {
      const usage = await getStorageUsageQuery();
      return {
        locale: resolveLocaleFromSearch(location.search),
        storageUsage: usage,
        storageError: null,
      };
    } catch (error) {
      return {
        locale: resolveLocaleFromSearch(location.search),
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
  component: () => <SettingsPage loaderData={Route.useLoaderData()} />,
});
