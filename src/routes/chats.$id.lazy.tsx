import { createLazyFileRoute } from "@tanstack/react-router";

import { SessionDetailPage } from "../modules/sessions/presentation/SessionDetailPage.tsx";

export const Route = createLazyFileRoute("/chats/$id")({
  component: ChatDetailRoute,
});

function ChatDetailRoute() {
  return <SessionDetailPage session={Route.useLoaderData().session} />;
}
