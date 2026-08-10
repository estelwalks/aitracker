import { createFileRoute } from "@tanstack/react-router";

import { getSkillWorkspace } from "../modules/skill-catalog/query";
import { SkillsPage } from "../modules/skill-catalog/presentation";
import { getDashboardReadModel } from "../modules/dashboard/query";
import { brandParams } from "../lib/app-config";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";

// The route forwards opaque installationRef values from the public query facade;
// filesystem paths remain confined to server-side adapters.
export const Route = createFileRoute("/agents")({
  loader: async ({ location }) => {
    const locale = resolveLocaleFromSearch(location.search);
    const [data, usage] = await Promise.all([
      getSkillWorkspace(),
      getDashboardReadModel({ data: locale }),
    ]);
    return { ...data, usage, locale };
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
  component: AgentsRoute,
});

function AgentsRoute() {
  const { usage, ...initial } = Route.useLoaderData();
  return <SkillsPage initial={initial} usage={usage} showWorkspace={false} />;
}
