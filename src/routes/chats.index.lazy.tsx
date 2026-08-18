import { createLazyFileRoute } from "@tanstack/react-router";

import { SessionsPage } from "../modules/sessions/presentation/SessionsPage.tsx";

export const Route = createLazyFileRoute("/chats/")({
  component: ChatsIndexRoute,
});

function ChatsIndexRoute() {
  return <SessionsPage initial={Route.useLoaderData()} />;
}
