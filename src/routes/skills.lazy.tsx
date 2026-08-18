import { createLazyFileRoute, Navigate } from "@tanstack/react-router";

import { SkillHubPage } from "../modules/skill-distribution/presentation/SkillHubPage";

export const Route = createLazyFileRoute("/skills")({
  component: SkillsRoute,
});

function SkillsRoute() {
  const { tab } = Route.useSearch();
  const initial = Route.useLoaderData();

  if (tab === "market") {
    return <Navigate to="/market" replace />;
  }

  return <SkillHubPage initial={initial} />;
}
