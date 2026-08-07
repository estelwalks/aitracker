import type {
  AIExecutionResult,
  AIExecutionSummary,
} from "../ai-orchestration/contracts.ts";
import type {
  CandidateOutput,
  ControlledSessionSummary,
  DistillationMode,
  SessionRef,
} from "./contracts.ts";
import type { SessionSummary } from "../sessions/contracts.ts";

const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UNSAFE =
  /(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\|\b(?:npm|pnpm|yarn|node|git)\s+|\b(?:bearer\s+|sk-|pk-)[A-Za-z0-9_-]{8,}|\b(?:api[_-]?key|password|secret|credential|authorization)\b)/i;
const MAX_TITLE = 120;
const MAX_SUMMARY = 4_000;

export function isOpaqueSessionRef(ref: SessionRef): boolean {
  return OPAQUE.test(ref.source) && OPAQUE.test(ref.sessionId);
}

export function controlledSessionSummary(
  session: SessionSummary,
  ref: SessionRef,
): ControlledSessionSummary {
  return {
    ref,
    title: safeText(session.title, MAX_TITLE),
    projectKey: safeText(session.projectKey, 120),
    model: session.model ? safeText(session.model, 120) : null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turns: session.turns,
    editTurns: session.editTurns,
    retryTurns: session.retryTurns,
    subagentCalls: session.subagentCalls,
    status: session.status,
  };
}

export function safeText(value: string, maxLength: number): string {
  const trimmed = value.trim().slice(0, maxLength);
  return !trimmed || UNSAFE.test(trimmed) ? "[REDACTED]" : trimmed;
}

export function controlledContext(
  rows: readonly ControlledSessionSummary[],
): string {
  return rows
    .map((row, index) => {
      const model = row.model ?? "unknown";
      return [
        `Session ${index + 1}: ${row.ref.source}:${row.ref.sessionId}`,
        `Title: ${row.title}`,
        `Project: ${row.projectKey}`,
        `Model: ${model}`,
        `Turns: ${row.turns}; edits: ${row.editTurns}; retries: ${row.retryTurns}; subagents: ${row.subagentCalls}`,
        `Status: ${row.status}; started: ${row.startedAt}; ended: ${row.endedAt}`,
      ].join("\n");
    })
    .join("\n\n");
}

export function modeForExecution(result: AIExecutionResult): DistillationMode {
  switch (result.summary.status) {
    case "completed":
      return "model";
    case "offline":
      return "offline";
    case "budget-exceeded":
      return "budget-exceeded";
    default:
      return "fallback";
  }
}

export function candidateText(
  result: AIExecutionResult,
  rows: readonly ControlledSessionSummary[],
): string {
  const text = result.response?.text?.trim();
  if (!text || UNSAFE.test(text)) {
    return `Distilled summary for ${rows.length} selected session${rows.length === 1 ? "" : "s"}.`;
  }
  return text.slice(0, MAX_SUMMARY);
}

export function candidateTitle(
  rows: readonly ControlledSessionSummary[],
): string {
  return `Distilled summary (${rows.length} session${rows.length === 1 ? "" : "s"})`;
}

export function publicExecution(result: AIExecutionResult): AIExecutionSummary {
  return result.summary;
}

export function cloneRefs(refs: readonly SessionRef[]): readonly SessionRef[] {
  return refs.map((ref) => ({ source: ref.source, sessionId: ref.sessionId }));
}

export function candidate(
  candidateId: string,
  refs: readonly SessionRef[],
  rows: readonly ControlledSessionSummary[],
  result: AIExecutionResult,
  now: string,
): CandidateOutput {
  return {
    candidateId,
    kind: "memory",
    title: candidateTitle(rows),
    summary: candidateText(result, rows),
    mode: modeForExecution(result),
    approvalState: "waiting-approval",
    selectedSessionRefs: cloneRefs(refs),
    generatedAt: now,
    execution: publicExecution(result),
  };
}
