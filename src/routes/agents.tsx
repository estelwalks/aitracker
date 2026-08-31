import { createFileRoute } from "@tanstack/react-router";

import { catalogs, getMessage } from "../lib/i18n/messages";
import { brandParams } from "../lib/app-config";
import {
  resolveLocaleFromSearch,
  resolveLocaleFromSearchParam,
  type Locale,
} from "../lib/i18n/locale";
import { getSkillWorkspace } from "../modules/skill-catalog/query";

type AgentsSearchParams = {
  agent?: string;
  locale?: Locale;
};

function safeAgentSearch(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const agent = value.trim();
  if (
    agent.length === 0 ||
    agent.length > 160 ||
    [...agent].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    return undefined;
  }
  return agent;
}

// The route forwards opaque installationRef values from the public query facade;
// filesystem paths remain confined to server-side adapters. Usage data arrives
// as the compact agent-overview projection (P1-T1-06) — never raw events.
// The page component lives in agents.lazy.tsx (P6-T6-04 route splitting).
export const Route = createFileRoute("/agents")({
  validateSearch: (search: Record<string, unknown>): AgentsSearchParams => ({
    agent: safeAgentSearch(search.agent),
    locale: resolveLocaleFromSearchParam(search.locale) ?? undefined,
  }),
  loaderDeps: ({ search }) => ({
    locale: resolveLocaleFromSearch(search as Record<string, unknown>),
  }),
  loader: async ({ deps }) => {
    // Agent usage aggregation can be materially larger than the Skill
    // workspace. Commit the route with its persisted workspace first; the
    // lazy page fetches analytics and security status after first paint.
    const data = await getSkillWorkspace();
    return { ...data, locale: deps.locale };
  },
  // Source mutations explicitly invalidate the router; repeated sidebar
  // visits reuse the same persisted snapshot instead of rebuilding all three
  // read models on every click.
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  preloadStaleTime: 30_000,
  head: ({ loaderData }) => ({
    meta: [
      {
        title: getMessage(
          catalogs[loaderData?.locale ?? "zh-CN"],
          "skills.agentOverview.title",
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
});
