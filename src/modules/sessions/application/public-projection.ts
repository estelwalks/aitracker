import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import type { SessionSummary } from "../contracts.ts";

/**
 * Maps scanner records to the browser-safe session contract. This lives
 * outside the server adapter so route and dashboard code never pull a
 * filesystem scanner into the client module graph.
 */
export function toPublicSession(record: SessionRecord): SessionSummary {
  return {
    sessionId: record.sessionId,
    source: record.source,
    title: record.title,
    projectKey: record.projectKey,
    model: record.model,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    durationMs: record.durationMs,
    turns: record.turns,
    editTurns: record.editTurns,
    retryTurns: record.retryTurns,
    totals: record.totals,
    cost: record.cost,
    subagentCalls: record.subagentCalls,
    status: record.status,
    statusReason: record.statusReason,
    resumeAvailable: record.resumeSafe,
  };
}
