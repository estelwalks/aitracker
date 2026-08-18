import { createLazyFileRoute } from "@tanstack/react-router";

import { TrackerPage } from "../modules/usage/presentation/TrackerPage";

export const Route = createLazyFileRoute("/tracker")({
  component: TrackerRoutePage,
});

function TrackerRoutePage() {
  const { model } = Route.useLoaderData();
  return <TrackerPage initial={model} />;
}
