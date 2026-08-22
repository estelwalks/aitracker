import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";
import type { Locale } from "../lib/i18n/locale";
import { getSkillWorkspace } from "../modules/skill-catalog/query";
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
    // The workspace snapshot is the only first-screen dependency. Usage
    // analytics are not rendered here, and distillation activity is fetched by
    // the mounted KPI after the workspace is interactive.
    const workspace = await getSkillWorkspace();
    return { locale: deps.locale, workspace };
  },
  // Source mutations explicitly invalidate the router. Retaining the compact
  // read model briefly makes ordinary sidebar navigation instant.
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 30_000,
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
