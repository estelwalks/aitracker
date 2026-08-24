import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import { getSkillWorkspace } from "../modules/skill-catalog/query";
import { getAgentUsageOverview } from "../modules/skill-catalog/usage-overview-query";
import { getDistillationQuery } from "../modules/distillation/query";
import type { SkillHubData } from "../modules/skill-distribution/presentation/SkillHubPage";

/** 兼容拆分前的 `?tab=market` 直达链接：市场已迁至独立 /market 路由。 */
type SkillsSearchParams = { tab?: "market" | "local" };

interface SkillsLoader extends SkillHubData {
  readonly locale: Locale;
}

// The page component lives in skills.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/skills")({
  validateSearch: (search: Record<string, unknown>): SkillsSearchParams => ({
    tab:
      search.tab === "market"
        ? "market"
        : search.tab === "local"
          ? "local"
          : undefined,
  }),
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }): Promise<SkillsLoader> => {
    const [workspace, usage, distillation] = await Promise.all([
      getSkillWorkspace(),
      // Compact agent-overview projection (P1-T1-07); the full dashboard DTO is
      // no longer loaded by the skills route.
      getAgentUsageOverview({ data: { locale: deps.locale } }),
      // Real distillation activity from the composition root; never breaks the
      // page when the workbench is unavailable.
      getDistillationQuery({ data: deps.locale })
        .then((view) => ({
          approved: view.stats.approved,
          waiting: view.candidates.filter(
            (candidate) => candidate.approvalState === "waiting-approval",
          ).length,
        }))
        .catch(() => null),
    ]);
    return { locale: deps.locale, workspace, usage, distillation };
  },
  // Skill snapshots can be changed by the Sources migration flow. Always
  // re-read the O(1) persisted snapshot when entering Skill management so a
  // cached route cannot show the pre-migration skill count.
  staleTime: 0,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
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
});
