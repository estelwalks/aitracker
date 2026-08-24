import { createFileRoute } from "@tanstack/react-router";

import { getSkillWorkspace } from "../modules/skill-catalog/query";
import { getAgentUsageOverview } from "../modules/skill-catalog/usage-overview-query";
import { getSecuritySkillVerdicts } from "../modules/security-assessment/query/agent-verdicts";
import { catalogs, getMessage } from "../lib/i18n/route-messages";
import { resolveLocaleFromSearch } from "../lib/i18n/locale";

// The route forwards opaque installationRef values from the public query facade;
// filesystem paths remain confined to server-side adapters. Usage data arrives
// as the compact agent-overview projection (P1-T1-06) — never raw events.
// The page component lives in agents.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/agents")({
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }) => {
    const [data, usage, securityVerdicts] = await Promise.all([
      getSkillWorkspace(),
      getAgentUsageOverview({ data: { locale: deps.locale } }),
      getSecuritySkillVerdicts(),
    ]);
    return { ...data, usage, securityVerdicts, locale: deps.locale };
  },
  // Agent/Skill snapshots can change from the Sources migration flow; do not
  // reuse a stale route loader result when entering the overview.
  staleTime: 0,
  gcTime: 5 * 60_000,
  preloadStaleTime: 0,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "skills.agentOverview.title",
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
});
