import {
  getLocalSessions,
  refreshLocalSessions,
} from "../../../lib/local-sessions/server-fns";
import { toPublicSession } from "../application/public-projection.ts";
import type { SessionFilter, SessionPage } from "../contracts";

type LegacySessionSummary = Awaited<ReturnType<typeof getLocalSessions>>;

function toPage(summary: LegacySessionSummary): SessionPage {
  const sessions = summary.sessions.map(toPublicSession);
  return {
    generatedAt: summary.generatedAt,
    sessions,
    total: sessions.length,
    page: 1,
    pageSize: Math.max(1, sessions.length),
    totalPages: 1,
  };
}

export async function getSessionsQuery(
  filter: SessionFilter = {},
): Promise<SessionPage> {
  return toPage(await getLocalSessions({ data: filter }));
}

export async function refreshSessionsQuery(
  filter: SessionFilter = {},
): Promise<SessionPage> {
  return toPage(await refreshLocalSessions({ data: filter }));
}
