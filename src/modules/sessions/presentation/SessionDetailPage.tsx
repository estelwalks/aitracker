import type { SessionSummary } from "../contracts.ts";
import { ChatHistorySidebar } from "./ChatHistorySidebar.tsx";
import { TranscriptPanel } from "./TranscriptPanel.tsx";

/**
 * Session detail page (Story S-300): session-history sidebar + full local
 * conversation with segment selection, resume card and report modal.
 *
 * PRIVACY BOUNDARY — the transcript shown here is read from the user's own
 * local logs, held in memory only, serialized into this page's response, and
 * never persisted or uploaded.
 */
export function SessionDetailPage({
  session,
  source,
}: {
  session: SessionSummary;
  source?: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <ChatHistorySidebar activeId={session.sessionId} source={source} />
      <TranscriptPanel session={session} />
    </div>
  );
}
