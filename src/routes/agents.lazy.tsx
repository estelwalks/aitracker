import { createLazyFileRoute } from "@tanstack/react-router";

import { SkillsPage } from "../modules/skill-catalog/presentation";

export const Route = createLazyFileRoute("/agents")({
  component: AgentsRoute,
});

function AgentsRoute() {
  const { usage, ...initial } = Route.useLoaderData();
  return <SkillsPage initial={initial} usage={usage} showWorkspace={false} />;
}
