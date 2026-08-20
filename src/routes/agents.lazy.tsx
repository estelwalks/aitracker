import { createLazyFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "../modules/skill-catalog/presentation";

export const Route = createLazyFileRoute("/agents")({
  component: AgentsRoute,
});

function AgentsRoute() {
  const { usage, securityVerdicts, ...initial } = Route.useLoaderData();
  return (
    <SkillsPage
      initial={initial}
      usage={usage}
      securityVerdicts={securityVerdicts}
      showWorkspace={false}
    />
  );
}
