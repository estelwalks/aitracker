import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import type { SessionSummary } from "../contracts.ts";

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UNSAFE_TEXT =
  /(?:[A-Za-z]:[\\/]|(?:^|\s)\/(?:[^\s/]+\/)*[^\s/]+|\b(?:bearer|token|secret|password|api[_-]?key|authorization)\b|\b(?:curl|wget|rm|chmod|powershell|bash|zsh|npm|node|git)\s+)/i;

function safeText(value: string, maximum: number): string {
  const normalized = Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
  return UNSAFE_TEXT.test(normalized) ? "" : normalized;
}

function safeModel(value: string | null): string | null {
  if (value == null) return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)
    ? normalized
    : null;
}

/**
 * Maps scanner records to the browser-safe session contract. This lives
 * outside the server adapter so route and dashboard code never pull a
 * filesystem scanner into the client module graph.
 */
export function toPublicSession(record: SessionRecord): SessionSummary {
  const resumableId = SAFE_SESSION_ID.test(record.sessionId);
  return {
    // Invalid scanner ids may themselves be a path-like or other unsafe value.
    // They remain visible as an unavailable row, but no raw identifier crosses
    // the server boundary and they cannot be opened or resumed.
    sessionId: resumableId ? record.sessionId : "unavailable",
    source: record.source,
    title: safeText(record.title, 120),
    projectKey: safeText(record.projectKey, 80) || "unknown",
    model: safeModel(record.model),
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
    statusReason:
      record.statusReason == null ? null : safeText(record.statusReason, 240),
    resumeAvailable: record.resumeSafe && resumableId,
  };
}
