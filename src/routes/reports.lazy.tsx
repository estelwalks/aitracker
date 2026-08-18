import { createLazyFileRoute } from "@tanstack/react-router";

import { ReportsPage } from "../modules/reports/query";

export const Route = createLazyFileRoute("/reports")({
  component: ReportsRoutePage,
});

function ReportsRoutePage() {
  const data = Route.useLoaderData();
  return <ReportsPage initial={data.viewModel} />;
}
