import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { brandParams } from "../lib/app-config";
import {
  normalizeCurrency,
  resolveLocaleFromSearch,
  resolveLocaleFromSearchParam,
  type Currency,
  type Locale,
} from "../lib/i18n/locale";
import {
  getSkillHubPageData,
  type SkillHubData,
} from "../modules/skill-distribution/query";

/** Compatibility for pre-split `?tab=market` deep links (market moved to /market). */
type SkillsSearchParams = {
  tab?: "market" | "local";
  /** Directory/manifest identity used to pre-filter the local Skill list. */
  skill?: string;
  /** Preserved here so in-page filter updates do not discard i18n state. */
  locale?: Locale;
  currency?: Currency;
};

function safeSkillSearch(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const skill = value.trim();
  if (
    skill.length === 0 ||
    skill.length > 160 ||
    [...skill].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    return undefined;
  }
  return skill;
}

// Page component lives in skills.lazy.tsx (P6-T6-04).
export const Route = createFileRoute("/skills")({
  validateSearch: (search: Record<string, unknown>): SkillsSearchParams => ({
    tab:
      search.tab === "market"
        ? "market"
        : search.tab === "local"
          ? "local"
          : undefined,
    skill: safeSkillSearch(search.skill),
    locale: resolveLocaleFromSearchParam(search.locale) ?? undefined,
    currency: normalizeCurrency(search.currency) ?? undefined,
  }),
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }): Promise<SkillHubData & { locale: Locale }> => {
    // One server RPC owns the payload; scanner/DB modules stay server-side
    // for client-side navigations too.
    const data = await getSkillHubPageData();
    return { locale: deps.locale, ...data };
  },
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 30_000,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "meta.titles.skills",
          brandParams,
        ),
      },
    ],
  }),
});
