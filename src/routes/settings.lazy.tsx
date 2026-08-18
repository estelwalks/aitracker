import { createLazyFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "../modules/settings/presentation";

export const Route = createLazyFileRoute("/settings")({
  component: SettingsRouteComponent,
});

function SettingsRouteComponent() {
  return <SettingsPage loaderData={Route.useLoaderData()} />;
}
