import { createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LoadErrorPanel } from "../components/LoadErrorPanel";
import { RoutePending } from "../components/RoutePending";
import { SkillsPage } from "../modules/skill-catalog/presentation";
import { getAgentUsageOverview } from "../modules/skill-catalog/usage-overview-query";
import type { AgentUsageOverviewReadModel } from "../modules/skill-catalog/usage-overview-contracts";
import {
  getSecuritySkillVerdicts,
  type SecuritySkillVerdictReadModel,
} from "../modules/security-assessment/index.ts";

export const Route = createLazyFileRoute("/agents")({
  component: AgentsRoute,
});

type LoadState = "loading" | "ready" | "error";

function AgentsRoute() {
  const { locale, ...initial } = Route.useLoaderData();
  const { agent } = Route.useSearch();
  const [usage, setUsage] = useState<AgentUsageOverviewReadModel | null>(null);
  const [securityVerdicts, setSecurityVerdicts] =
    useState<SecuritySkillVerdictReadModel | null>(null);
  const [status, setStatus] = useState<LoadState>("loading");
  // Bump to re-run the loader data fetch after a failure (retry button).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void Promise.all([
      getAgentUsageOverview({ data: { locale } }),
      getSecuritySkillVerdicts(),
    ])
      .then(([nextUsage, nextVerdicts]) => {
        if (cancelled) return;
        setUsage(nextUsage);
        setSecurityVerdicts(nextVerdicts);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [locale, attempt]);

  // P2-16: a failed loader fetch must never leave a permanent skeleton.
  if (status === "error") {
    return (
      <LoadErrorPanel
        titleKey="skills.agentOverview.loadFailed"
        descriptionKey="skills.agentOverview.loadFailedDesc"
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }

  if (status === "loading") return <RoutePending />;
  return (
    <SkillsPage
      initial={initial}
      initialAgentId={agent}
      usage={usage ?? undefined}
      securityVerdicts={securityVerdicts ?? undefined}
      showWorkspace={false}
    />
  );
}
