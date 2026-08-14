import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import { getSkillWorkspace } from "../modules/skill-catalog/query";
import { getDashboardReadModel } from "../modules/dashboard/query";
import { getDistillationQuery } from "../modules/distillation/query";
import { getMarketSkills } from "../modules/skill-distribution/query";
import type {
  SkillHubData,
  SkillHubTab,
} from "../modules/skill-distribution/presentation/SkillHubPage";
import { SkillHubPage } from "../modules/skill-distribution/presentation/SkillHubPage";

type SkillsSearchParams = { tab?: SkillHubTab };

interface SkillsLoader extends SkillHubData {
  readonly locale: Locale;
}

export const Route = createFileRoute("/skills")({
  validateSearch: (search: Record<string, unknown>): SkillsSearchParams => ({
    tab:
      search.tab === "market"
        ? "market"
        : search.tab === "local"
          ? "local"
          : undefined,
  }),
  loader: async ({ location }): Promise<SkillsLoader> => {
    const locale = resolveLocaleFromSearch(location.search);
    const [workspace, usage, market, distillation] = await Promise.all([
      getSkillWorkspace(),
      getDashboardReadModel({ data: locale }),
      getMarketSkills({
        data: { page: 1, limit: 12, search: "", sort: "downloads" },
      }),
      // Real distillation activity from the composition root; never breaks the
      // page when the workbench is unavailable.
      getDistillationQuery({ data: locale })
        .then((view) => ({
          approved: view.stats.approved,
          waiting: view.candidates.filter(
            (candidate) => candidate.approvalState === "waiting-approval",
          ).length,
        }))
        .catch(() => null),
    ]);
    return { locale, workspace, usage, market, distillation };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.skills",
        ),
      },
    ],
  }),
  component: SkillsRoute,
});

function SkillsRoute() {
  const { tab } = Route.useSearch();
  const initial = Route.useLoaderData();
  return <SkillHubPage initial={initial} initialTab={tab ?? "local"} />;
}
