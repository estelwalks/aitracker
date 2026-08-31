import type {
  AIExecutionResult,
  AIExecutionSummary,
} from "../ai-orchestration/contracts.ts";
import type {
  CandidateOutput,
  ControlledSessionSummary,
  DistillationMode,
  SegmentMaterial,
  SegmentMessage,
  SegmentRef,
  SessionRef,
} from "./contracts.ts";
import type {
  SessionSummary,
  SessionTranscript,
} from "../sessions/contracts.ts";

const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/**
 * Redaction (not wholesale rejection) for distilled text. Everyday technical
 * prose — "npm run", "git workflow", "API key security management" — is retained; only
 * genuine private fragments are removed so the distilled persona / task memory
 * keeps its content (Bug: the previous all-or-nothing regex collapsed any
 * node/npm/git mention into a useless placeholder). Mirror of the knowledge
 * module's provenance filter: identity-revealing absolute paths → `~/`,
 * credential VALUES → `[REDACTED]`.
 */
const PRIVATE_PATH_RE =
  /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:(?:\\[^\s"'<>|\\]*)+|\\\\[A-Za-z0-9._-]+\\[^\s"'<>|\\]+)/g;
const CREDENTIAL_VALUE_RE =
  /(?:sk-[A-Za-z0-9_-]{8,}|pk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~-]{12,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[A-Za-z0-9._~/+=-]{8,})/gi;
const MAX_TITLE = 120;
const MAX_SUMMARY = 24_000;

function sanitizeDistilledText(value: string): string {
  // Replace the path root with a bare `~` (no trailing slash) so the remaining
  // path joins cleanly: /Users/me/project → ~/project.
  return value
    .replace(PRIVATE_PATH_RE, "~")
    .replace(CREDENTIAL_VALUE_RE, "[REDACTED]");
}

// The memory/persona prompts mandate a top-level H1 that duplicates the asset
// type ("# Task Memory" / "# User Portrait"), which the card's type badge already
// carries. Stripping it keeps the stored body a clean document (the memory
// title comes from the entry's `title`), so the card never reads as the
// heading rendered twice. Mirrors the prototype's memory bodies, which have
// no redundant heading.
const REDUNDANT_HEADING_RE: Record<string, RegExp> = {
  memory: /^#\s*任务记忆[ \t]*\n+/u,
  persona: /^#\s*用户画像[ \t]*\n+/u,
};
function stripRedundantHeading(
  value: string,
  kind: CandidateOutput["kind"],
): string {
  const re = REDUNDANT_HEADING_RE[kind];
  return re ? value.replace(re, "") : value;
}

export function isOpaqueSessionRef(ref: SessionRef): boolean {
  return OPAQUE.test(ref.source) && OPAQUE.test(ref.sessionId);
}

/**
 * A segment ref is valid only when its source/sessionId are opaque public
 * ids and its window is a non-negative, non-inverted inclusive range. It is
 * deliberately agnostic about the transcript's actual length — extraction
 * clamps out-of-range windows instead of rejecting them.
 */
export function isValidSegmentRef(segment: SegmentRef): boolean {
  return (
    isOpaqueSessionRef(segment) &&
    Number.isInteger(segment.startIndex) &&
    Number.isInteger(segment.endIndex) &&
    segment.startIndex >= 0 &&
    segment.endIndex >= 0 &&
    segment.startIndex <= segment.endIndex
  );
}

/**
 * Extract the inclusive `[startIndex..endIndex]` window of a transcript into
 * renderer-safe in-memory segment messages. Out-of-range windows clamp to the
 * available messages; empty/whitespace-only messages are dropped. The result
 * is memory-only and exists solely to feed the current AI request.
 */
export function extractSegmentMessages(
  transcript: SessionTranscript,
  segment: SegmentRef,
): readonly SegmentMessage[] {
  const start = Math.max(0, Math.trunc(segment.startIndex));
  const end = Math.min(
    transcript.messages.length - 1,
    Math.trunc(segment.endIndex),
  );
  if (start > end) return [];
  return transcript.messages
    .slice(start, end + 1)
    .map((message) => ({ role: message.role, text: message.text }))
    .filter((message) => message.text.trim().length > 0);
}

/**
 * Render the user-selected segment materials into the markdown block appended
 * to the distillation prompt input. This text is only ever part of the
 * in-memory AI request; it is never persisted and never uploaded.
 */
export function segmentMarkdown(materials: readonly SegmentMaterial[]): string {
  return materials
    .map((material) => {
      const header = `### ${material.source}:${material.sessionId}${
        material.title ? ` — ${material.title}` : ""
      }`;
      const body = material.messages
        .map((message) => `**${message.role}**: ${message.text}`)
        .join("\n\n");
      return `${header}\n\n${body}`;
    })
    .join("\n\n");
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
  const sanitized = sanitizeDistilledText(value).trim().slice(0, maxLength);
  return !sanitized ? "[REDACTED]" : sanitized;
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
  kind: CandidateOutput["kind"],
): string {
  const text = result.response?.text?.trim();
  if (!text) {
    const asset =
      kind === "skill"
        ? "skill package"
        : kind === "brief"
          ? "workflow"
          : kind === "prompt"
            ? "prompt template"
            : kind === "persona"
              ? "persona memory"
              : "task memory";
    return `Distilled ${asset} for ${rows.length} selected session${rows.length === 1 ? "" : "s"}.`;
  }
  // Keep the distilled prose; redact only private fragments (paths → ~/,
  // credential values → [REDACTED]). A realistic developer persona that
  // mentions node/npm/git must flow through to the memory module intact.
  // A prompt-mandated redundant H1 ("# Task Memory" / "# User Portrait") is dropped —
  // the memory card's type badge already labels it, and without the strip the
  // stored body's first line reads as a second title (title/body look swapped).
  const sanitized = stripRedundantHeading(
    sanitizeDistilledText(text),
    kind,
  ).trim();
  if (!sanitized) {
    return `Distilled ${kind === "persona" ? "persona memory" : kind === "memory" ? "task memory" : kind} for ${rows.length} selected session${rows.length === 1 ? "" : "s"}.`;
  }
  return sanitized.slice(0, MAX_SUMMARY);
}

export function candidateTitle(
  rows: readonly ControlledSessionSummary[],
  kind: CandidateOutput["kind"],
): string {
  const projectKeys = [...new Set(rows.map((row) => row.projectKey))].filter(
    Boolean,
  );
  const lead = projectKeys[0] ?? rows[0]?.title ?? "Session";
  const suffix =
    projectKeys.length > 1
      ? ` +${projectKeys.length - 1} projects`
      : rows.length > 1
        ? ` · ${rows.length} sessions`
        : "";
  switch (kind) {
    case "skill":
      return `${lead} Skill Package${suffix}`;
    case "brief":
      return `${lead} Workflow${suffix}`;
    case "prompt":
      return `${lead} Prompt Template${suffix}`;
    case "persona":
      return `${lead} Persona Memory${suffix}`;
    case "memory":
    default:
      return `${lead} Task Memory${suffix}`;
  }
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
  kind: CandidateOutput["kind"] = "memory",
): CandidateOutput {
  return {
    candidateId,
    kind,
    title: candidateTitle(rows, kind),
    summary: candidateText(result, rows, kind),
    mode: modeForExecution(result),
    approvalState: "waiting-approval",
    selectedSessionRefs: cloneRefs(refs),
    generatedAt: now,
    execution: publicExecution(result),
  };
}
