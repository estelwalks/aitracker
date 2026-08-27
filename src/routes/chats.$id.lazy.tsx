import { createLazyFileRoute } from "@tanstack/react-router";

import { SessionDetailPage } from "../modules/sessions/presentation/SessionDetailPage.tsx";
import { InsightCard } from "../modules/insights/index.ts";

export const Route = createLazyFileRoute("/chats/$id")({
  component: ChatDetailRoute,
});

function ChatDetailRoute() {
  const { id } = Route.useParams();
  const { session, source } = Route.useLoaderData();
  return (
    <div className="space-y-4">
      <InsightCard
        surfaceId="chat-detail"
        scope={{ entityId: id }}
        variant="inline"
      />
      <SessionDetailPage session={session} source={source} />
    </div>
  );
}
