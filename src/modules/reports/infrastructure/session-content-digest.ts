/**
 * Turns a raw session transcript into a bounded, locally redacted digest of
 * what the user asked for and what the agent delivered.
 *
 * This is the only report input that carries conversation substance. It exists
 * so daily/weekly/monthly reports can be grounded in real work instead of
 * restating counters, and it is deliberately conservative:
 *
 * - the caller owns the filesystem boundary (`readSessionContent`); this module
 *   only consumes the transcript it is handed;
 * - absolute paths, credentials and e-mail addresses are replaced with
 *   placeholders BEFORE the text can reach a model or a report body;
 * - messages, per-field length and total size are hard-capped so one long
 *   session cannot blow the request budget;
 * - system/instruction preambles (`<...>` blocks, AGENTS.md dumps) are skipped
 *   so the digest describes the work, not the harness.
 */

import type { ReportSessionDigest } from "../contracts.ts";

/** Structural subset of `SessionTranscriptMessage`; keeps this module decoupled. */
export interface DigestMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface DigestOptions {
  /** Per-field character cap. */
  readonly maxFieldChars?: number;
  /** How many user turns to sample across the session. */
  readonly maxGoals?: number;
  /** How many progress reports to sample across the session. */
  readonly maxProgress?: number;
  /** How many trailing assistant turns to keep as the outcome. */
  readonly maxOutcome?: number;
}

// A report has to describe the work, not hint at it: these budgets are sized so
// a handful of sessions still fit one request while each keeps enough substance
// to write several sentences about it.
const DEFAULT_MAX_FIELD_CHARS = 800;
const DEFAULT_MAX_GOALS = 8;
const DEFAULT_MAX_PROGRESS = 8;
const DEFAULT_MAX_OUTCOME = 3;
/** Minimum length for a closing turn to count as a real outcome summary. */
const MIN_SUBSTANTIVE_CHARS = 40;
/** Minimum length for a turn to count as a progress note. */
const MIN_PROGRESS_CHARS = 12;

const PLACEHOLDERS = {
  path: "<path>",
  secret: "<secret>",
  email: "<email>",
  home: "<home>",
} as const;

const REDACTIONS: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  // Credentials first: they can contain characters the path rules would eat.
  { pattern: /\bsk-[A-Za-z0-9_-]{8,}\b/gu, replacement: PLACEHOLDERS.secret },
  { pattern: /\bghp_[A-Za-z0-9]{12,}\b/gu, replacement: PLACEHOLDERS.secret },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/gu, replacement: PLACEHOLDERS.secret },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/giu,
    replacement: PLACEHOLDERS.secret,
  },
  {
    pattern: /\b(?:api[_-]?key|password|passwd|secret|token)\b\s*[:=]\s*\S+/giu,
    replacement: PLACEHOLDERS.secret,
  },
  // E-mail addresses before the path rule (they contain no slashes, but the
  // order keeps the intent obvious).
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/gu,
    replacement: PLACEHOLDERS.email,
  },
  // Home-relative and absolute POSIX paths, then Windows paths.
  { pattern: /~\/[\S]+/gu, replacement: PLACEHOLDERS.home },
  {
    pattern: /(?:\/Users|\/home|\/private|\/var|\/opt)\/[\S]*/gu,
    replacement: PLACEHOLDERS.path,
  },
  { pattern: /\b[A-Za-z]:\\[\S]*/gu, replacement: PLACEHOLDERS.path },
];

/**
 * Replace sensitive material in free text. Exported so report writers can
 * sanitise model output with the same rules used for model input.
 */
export function redactSessionText(text: string): {
  readonly text: string;
  readonly redacted: boolean;
} {
  let next = text;
  let redacted = false;
  for (const { pattern, replacement } of REDACTIONS) {
    const before = next;
    next = next.replace(pattern, replacement);
    if (next !== before) redacted = true;
  }
  return { text: next, redacted };
}

function collapse(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Harness noise rather than user intent: injected instruction blocks, agent
 * guideline dumps and tool envelopes.
 */
function isPreamble(text: string): boolean {
  const head = text.trimStart().slice(0, 40).toLowerCase();
  if (head.startsWith("<")) return true;
  if (head.includes("agents.md")) return true;
  if (head.includes("claude.md")) return true;
  if (head.startsWith("# instructions")) return true;
  return false;
}

function usableTurns(
  messages: readonly DigestMessage[],
  role: DigestMessage["role"],
): string[] {
  return messages
    .filter((message) => message.role === role)
    .map((message) => message.text)
    .filter((text) => text.trim().length > 0 && !isPreamble(text));
}

/** Pick up to `count` items spread across the list, keeping both ends. */
function sampleEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) return [items[0]!];
  const picked: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const index = Math.round((i * (items.length - 1)) / (count - 1));
    if (seen.has(index)) continue;
    seen.add(index);
    picked.push(items[index]!);
  }
  return picked;
}

function cap(text: string, max: number): string {
  const normalized = collapse(text);
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max).trimEnd()}…`;
}

/**
 * Build the digest. Fields are truncated first and redacted second so a
 * placeholder can never be split by the truncation boundary.
 */
export function buildSessionContentDigest(
  title: string,
  messages: readonly DigestMessage[],
  options: DigestOptions = {},
): ReportSessionDigest {
  const maxFieldChars = options.maxFieldChars ?? DEFAULT_MAX_FIELD_CHARS;
  const maxGoals = options.maxGoals ?? DEFAULT_MAX_GOALS;
  const maxProgress = options.maxProgress ?? DEFAULT_MAX_PROGRESS;
  const maxOutcome = options.maxOutcome ?? DEFAULT_MAX_OUTCOME;

  // A long session's arc matters more than its first four messages: sample the
  // user turns evenly (always keeping the first and last) so a day-long
  // session is represented by its whole trajectory, not just its opening.
  const rawGoals = sampleEvenly(usableTurns(messages, "user"), maxGoals);
  // Prefer substantial closing output; fall back to whatever exists last.
  const assistantTurns = usableTurns(messages, "assistant");
  const substantive = assistantTurns.filter(
    (text) => collapse(text).length >= MIN_SUBSTANTIVE_CHARS,
  );
  const rawOutcome = (
    substantive.length > 0 ? substantive : assistantTurns
  ).slice(-maxOutcome);
  // Progress samples the remaining assistant turns across the session. The bar
  // is deliberately low (progress notes are often one short line) but still
  // drops bare acknowledgements.
  const rawProgress = sampleEvenly(
    assistantTurns.filter(
      (text) =>
        collapse(text).length >= MIN_PROGRESS_CHARS &&
        !rawOutcome.includes(text),
    ),
    maxProgress,
  );

  let redacted = false;
  const clean = (value: string): string => {
    const result = redactSessionText(cap(value, maxFieldChars));
    redacted = redacted || result.redacted;
    return result.text;
  };

  const titleResult = redactSessionText(cap(title, 120));
  redacted = redacted || titleResult.redacted;

  return {
    title: titleResult.text,
    goals: rawGoals.map(clean),
    progress: rawProgress.map(clean),
    outcome: rawOutcome.map(clean),
    redacted,
  };
}

/** Render a digest for a model prompt. */
export function renderSessionDigest(digest: ReportSessionDigest): string {
  const lines: string[] = [`### 会话：${digest.title}`];
  if (digest.goals.length > 0) {
    lines.push("用户诉求：");
    for (const goal of digest.goals) lines.push(`- ${goal}`);
  }
  if (digest.progress.length > 0) {
    lines.push("过程进展：");
    for (const item of digest.progress) lines.push(`- ${item}`);
  }
  if (digest.outcome.length > 0) {
    lines.push("最终产出：");
    for (const item of digest.outcome) lines.push(`- ${item}`);
  }
  if (
    digest.goals.length === 0 &&
    digest.progress.length === 0 &&
    digest.outcome.length === 0
  ) {
    lines.push("（未提取到可用的会话内容）");
  }
  return lines.join("\n");
}
