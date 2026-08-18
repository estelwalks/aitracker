import { createLazyFileRoute } from "@tanstack/react-router";

import { decodeSegmentRef } from "../lib/distill-segment";
import { DistillationPage } from "../modules/distillation/presentation/DistillationPage";

export const Route = createLazyFileRoute("/distill")({
  component: DistillationRoutePage,
});

function DistillationRoutePage() {
  const data = Route.useLoaderData();
  const { segment } = Route.useSearch();
  return (
    <DistillationPage
      initial={data}
      initialSegment={segment ? decodeSegmentRef(segment) : null}
    />
  );
}
