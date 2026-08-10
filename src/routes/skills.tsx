import { createFileRoute } from "@tanstack/react-router";

import { getSkillWorkspace } from "../modules/skill-catalog/query";
import { SkillsPage } from "../modules/skill-catalog/presentation";
import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";

// The route forwards opaque installationRef values from the public query facade;
// filesystem paths remain confined to server-side adapters.
export const Route = createFileRoute("/skills")({
  loader: async ({ location }) => {
    const data = await getSkillWorkspace();
    return { ...data, locale: resolveLocaleFromSearch(location.search) };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.skills",
          brandParams,
        ),
      },
      {
        name: "description",
        content: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "skills.metaDesc",
        ),
      },
    ],
  }),
  component: SkillsRoute,
});

function SkillsRoute() {
  return <SkillsPage initial={Route.useLoaderData()} />;
}
