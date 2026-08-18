import { createLazyFileRoute } from "@tanstack/react-router";

import { SourcesPage } from "../modules/sources/query/presentation";

export const Route = createLazyFileRoute("/sources")({
  component: SourcesRoutePage,
});

function SourcesRoutePage() {
  return <SourcesPage initial={Route.useLoaderData()} />;
}
