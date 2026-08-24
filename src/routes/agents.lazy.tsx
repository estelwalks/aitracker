import { createLazyFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { RoutePending } from "../components/RoutePending";
import { SkillsPage } from "../modules/skill-catalog/presentation";
import { getAgentUsageOverview } from "../modules/skill-catalog/usage-overview-query";
import type { AgentUsageOverviewReadModel } from "../modules/skill-catalog/usage-overview-contracts";
import {
  getSecuritySkillVerdicts,
  type SecuritySkillVerdictReadModel,
} from "../modules/security-assessment/query/agent-verdicts";

export const Route = createLazyFileRoute("/agents")({
  component: AgentsRoute,
});

function AgentsRoute() {
  const { locale, ...initial } = Route.useLoaderData();
  const [usage, setUsage] = useState<AgentUsageOverviewReadModel | null>(null);
  const [securityVerdicts, setSecurityVerdicts] =
    useState<SecuritySkillVerdictReadModel | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      getAgentUsageOverview({ data: { locale } }),
      getSecuritySkillVerdicts(),
    ])
      .then(([nextUsage, nextVerdicts]) => {
        if (cancelled) return;
        setUsage(nextUsage);
        setSecurityVerdicts(nextVerdicts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locale]);

  if (usage == null) return <RoutePending />;
  return (
    <SkillsPage
      initial={initial}
      usage={usage}
      securityVerdicts={securityVerdicts ?? undefined}
      showWorkspace={false}
    />
  );
}
