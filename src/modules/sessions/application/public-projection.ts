import type { SessionRecord } from "../../../lib/local-sessions/types.ts";
import type { SessionSummary } from "../contracts.ts";

const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const UNSAFE_TEXT =
  /(?:[A-Za-z]:[\\/]|(?:^|\s)\/(?:[^\s/]+\/)*[^\s/]+|\b(?:bearer|token|secret|password|api[_-]?key|authorization)\b|\b(?:curl|wget|rm|chmod|powershell|bash|zsh|npm|node|git)\s+)/i;

function normalizedText(value: string, maximum: number): string {
  return Array.from(value, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function safeText(value: string, maximum: number): string {
  const normalized = normalizedText(value, maximum);
  return UNSAFE_TEXT.test(normalized) ? "" : normalized;
}

function fallbackTitle(source: string): string {
  switch (source) {
    case "claude-code":
      return "Claude Code session";
    case "codex":
      return "Codex session";
    case "grok":
      return "Grok session";
    default:
      return "AI session";
  }
}

/** Redact unsafe fragments without throwing away the whole useful title. */
function safeTitle(value: string, source: string): string {
  const redacted = normalizedText(value, 240)
    .replace(/https?:\/\/\S+/giu, "[link]")
    .replace(/[A-Za-z]:[\\/]+[^\s"'<>]*/gu, "[path]")
    .replace(/(?:^|\s)\/(?:[^\s/]+\/)*[^\s"'<>]*/gu, " [path]")
    .replace(
      /\b(?:bearer\s+\S+|(?:api[_-]?key|token|password|secret|authorization)\s*[:=]?\s*\S*)/giu,
      "[sensitive]",
    )
    .replace(
      /\b(?:curl|wget|rm|chmod|powershell|bash|zsh|npm|node|git)\s+/giu,
      "",
    )
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 120);
  return redacted && !UNSAFE_TEXT.test(redacted)
    ? redacted
    : fallbackTitle(source);
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
    title: safeTitle(record.title, record.source),
    projectKey: safeText(record.projectKey, 80) || "unknown",
    isGitProject: record.isGitProject === true,
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
