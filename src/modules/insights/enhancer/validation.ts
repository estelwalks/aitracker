/**
 * Five-layer output validation for the Insight Enhancer, plus the payload
 * safety assertion for outbound provider input. Every function is pure (no
 * I/O, no repository access) so each layer is independently testable.
 *
 * L1 transport: length bound + JSON-only (tolerating a ```json fence).
 * L2 schema:    strict Zod shape.
 * L3 reference: candidate ids come from this request, no dupes, mandatory kept.
 * L4 fact/action: no digits/urls/paths/commands/code blocks, action in scope.
 * L5 safety:    secrets, injection, over-safety promises, forbidden words, and
 *               caller-declared entity names.
 *
 * The literal unions live in M1's `page/contracts.ts`; the runtime action list
 * is duplicated here only because M1 exposes it as a type, not a value.
 */
import { z } from "zod";
import type {
  InsightActionId,
  InsightEnhancementInput,
  InsightSurfaceId,
} from "../page/contracts.ts";

export const MAX_RESPONSE_TEXT_LENGTH = 4096;
export const MAX_ANALYSIS_CHARS = 160;
export const MAX_LINES = 3;
export const WIDGET_MAX_LINES = 1;
export const CANDIDATE_ID_MIN = 1;
export const CANDIDATE_ID_MAX = 80;
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Runtime whitelist backing the Zod enum and the L4 action check. */
export const INSIGHT_ACTION_IDS: readonly InsightActionId[] = [
  "open_security",
  "open_distill",
  "open_reports",
  "open_sessions",
  "open_sources",
  "open_settings",
  "open_tracker",
  "open_market",
  "open_skills",
  "open_memory",
];

export type ValidationStage = 1 | 2 | 3 | 4 | 5;

export interface InsightEnhancementLine {
  readonly candidateId: string;
  readonly analysis?: string;
  readonly actionId?: InsightActionId;
}

export interface ValidatedEnhancementLine {
  readonly candidateId: string;
  readonly analysis: string;
  readonly actionId?: InsightActionId;
}

export type ValidateEnhancementOutputResult =
  | { readonly ok: true; readonly output: readonly ValidatedEnhancementLine[] }
  | {
      readonly ok: false;
      readonly stage: ValidationStage;
      readonly reason: string;
    };

export interface ValidateEnhancementOutputOptions {
  readonly forbiddenEntities?: readonly string[];
  /** Extra application-specific words that must never appear in output. */
  readonly forbiddenWords?: readonly string[];
}

export interface AssertPayloadSafeOptions {
  readonly forbiddenEntities?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* Pattern tables                                                      */
/* ------------------------------------------------------------------ */

const DIGIT_PATTERN = /\d/;

const URL_PATTERNS = [
  /https?:\/\//i,
  /(?:^|[^\w.])www\.[a-z0-9-]+\./i,
  /(?:^|[^\w.])[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|io|ai|dev|app|co|cn|me|info|xyz|top|site|gov|edu|cloud|sh)\b/i,
];

const PATH_PATTERNS = [
  /[A-Za-z]:\\/, // C:\ D:\
  /\\/, // any backslash (incl. UNC \\server and JSON-escaped \)
  /\/(?:Users|home|var|tmp)\//i,
  /^\/[^~\s]/, // bare POSIX absolute path at the start of the text
];

const COMMAND_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bsudo\b/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bnpm\s+(?:install|run|ci|exec|publish|test)\b/i,
  /\b(?:npx|pnpm|yarn)\s+[a-z]/i,
  /\bpip\s+install\b/i,
  /\bbash\s+-c\b/i,
  /\bsh\s+-c\b/i,
  /\bpowershell\b/i,
  /\bcmd(?:\.exe)?\b/i,
  /\bgit\s+(?:push|pull|clone|commit|checkout|reset)\b/i,
  /\bchmod\b/i,
];

const CODE_BLOCK_PATTERN = /```|`/;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\([^)]*\)/;

const SENSITIVE_PATTERN =
  /\b(?:api[ _-]?key|bearer|password|passwd|passphrase|credential|secret|private[ _-]?key)\b/i;
const SECRET_VALUE_PATTERN = /\bsk-[a-z0-9_-]{8,}\b/i;

const INJECTION_PATTERNS = [
  /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above|your)\s+instructions/i,
  /\bsystem\s+prompt\b/i,
  /\bjailbreak\b/i,
];

const OVER_SAFETY_PATTERNS = [
  /绝对安全/,
  /100%?\s*(?:安全|safe)/i,
  /guaranteed\s+safe/i,
];

/* ------------------------------------------------------------------ */
/* Issue detectors                                                    */
/* ------------------------------------------------------------------ */

function findDigitIssue(text: string): string | undefined {
  return DIGIT_PATTERN.test(text) ? "digit" : undefined;
}

function findUrlIssue(text: string): string | undefined {
  for (const pattern of URL_PATTERNS) {
    if (pattern.test(text)) return "url";
  }
  return undefined;
}

function findPathIssue(text: string): string | undefined {
  for (const pattern of PATH_PATTERNS) {
    if (pattern.test(text)) return "absolute path";
  }
  return undefined;
}

function findCommandIssue(text: string): string | undefined {
  for (const pattern of COMMAND_PATTERNS) {
    if (pattern.test(text)) return "command";
  }
  return undefined;
}

function findCodeBlockIssue(text: string): string | undefined {
  if (CODE_BLOCK_PATTERN.test(text)) return "code block";
  if (MARKDOWN_LINK_PATTERN.test(text)) return "markdown link";
  return undefined;
}

function findSecretIssue(text: string): string | undefined {
  if (SECRET_VALUE_PATTERN.test(text)) return "secret-shaped value";
  if (SENSITIVE_PATTERN.test(text)) return "sensitive keyword";
  return undefined;
}

function findInjectionIssue(text: string): string | undefined {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) return "prompt injection";
  }
  return undefined;
}

function findOverSafetyIssue(text: string): string | undefined {
  for (const pattern of OVER_SAFETY_PATTERNS) {
    if (pattern.test(text)) return "over-safety promise";
  }
  return undefined;
}

function findEntityIssue(
  text: string,
  entities: readonly string[] | undefined,
): string | undefined {
  const haystack = text.toLowerCase();
  for (const entity of entities ?? []) {
    const needle = entity.trim().toLowerCase();
    if (needle !== "" && haystack.includes(needle)) {
      return `entity name "${entity.trim()}"`;
    }
  }
  return undefined;
}

function findForbiddenWordIssue(
  text: string,
  words: readonly string[] | undefined,
): string | undefined {
  const haystack = text.toLowerCase();
  for (const word of words ?? []) {
    const needle = word.trim().toLowerCase();
    if (needle !== "" && haystack.includes(needle)) {
      return `forbidden word "${word.trim()}"`;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Zod schema                                                          */
/* ------------------------------------------------------------------ */

const actionIdSchema = z.enum(
  INSIGHT_ACTION_IDS as unknown as [string, ...string[]],
);

type ParsedLine = {
  readonly candidateId: string;
  readonly analysis: string;
  readonly actionId?: string;
};

function outputSchema(maxLines: number): z.ZodType<{ lines: ParsedLine[] }> {
  return z
    .object({
      lines: z
        .array(
          z
            .object({
              candidateId: z
                .string()
                .trim()
                .min(CANDIDATE_ID_MIN)
                .max(CANDIDATE_ID_MAX),
              analysis: z.string().trim().min(1).max(MAX_ANALYSIS_CHARS),
              actionId: actionIdSchema.optional(),
            })
            .strict(),
        )
        .min(1)
        .max(maxLines),
    })
    .strict();
}

function summarizeZodError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "schema violation";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Strips a leading ```json / ``` and a trailing ``` fence, then trims. */
export function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function maxLinesFor(surface: InsightSurfaceId): number {
  return surface === "widget" ? WIDGET_MAX_LINES : MAX_LINES;
}

export function validateEnhancementOutput(
  rawText: string,
  input: InsightEnhancementInput,
  options: ValidateEnhancementOutputOptions = {},
): ValidateEnhancementOutputResult {
  // L1 — transport.
  if (rawText.length > MAX_RESPONSE_TEXT_LENGTH) {
    return { ok: false, stage: 1, reason: "response exceeds the length limit" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    return { ok: false, stage: 1, reason: "response is not JSON" };
  }

  // L2 — schema.
  const parsedSchema = outputSchema(maxLinesFor(input.surface)).safeParse(
    parsed,
  );
  if (!parsedSchema.success) {
    return {
      ok: false,
      stage: 2,
      reason: summarizeZodError(parsedSchema.error),
    };
  }
  const lines = parsedSchema.data.lines;

  // L3 — reference integrity.
  const candidatesById = new Map(input.candidates.map((c) => [c.id, c]));
  const seen = new Set<string>();
  for (const line of lines) {
    if (!candidatesById.has(line.candidateId)) {
      return {
        ok: false,
        stage: 3,
        reason: `unknown candidateId "${line.candidateId}"`,
      };
    }
    if (seen.has(line.candidateId)) {
      return {
        ok: false,
        stage: 3,
        reason: `duplicate candidateId "${line.candidateId}"`,
      };
    }
    seen.add(line.candidateId);
  }
  for (const candidate of input.candidates) {
    if (candidate.mandatory && !seen.has(candidate.id)) {
      return {
        ok: false,
        stage: 3,
        reason: `mandatory candidate "${candidate.id}" is missing`,
      };
    }
  }

  const actionIdSet = new Set<string>(INSIGHT_ACTION_IDS);

  // L4 — fact / action.
  for (const line of lines) {
    const contentIssue =
      findDigitIssue(line.analysis) ??
      findUrlIssue(line.analysis) ??
      findPathIssue(line.analysis) ??
      findCommandIssue(line.analysis) ??
      findCodeBlockIssue(line.analysis);
    if (contentIssue !== undefined) {
      return {
        ok: false,
        stage: 4,
        reason: `analysis contains ${contentIssue}`,
      };
    }
    if (line.actionId !== undefined) {
      if (!actionIdSet.has(line.actionId)) {
        return { ok: false, stage: 4, reason: "actionId is not allowlisted" };
      }
      const candidate = candidatesById.get(line.candidateId)!;
      if (!candidate.actionIds.includes(line.actionId as InsightActionId)) {
        return {
          ok: false,
          stage: 4,
          reason: `actionId "${line.actionId}" is not allowed for candidate "${candidate.id}"`,
        };
      }
    }
  }

  // L5 — safety.
  for (const line of lines) {
    const safetyIssue =
      findSecretIssue(line.analysis) ??
      findInjectionIssue(line.analysis) ??
      findOverSafetyIssue(line.analysis) ??
      findForbiddenWordIssue(line.analysis, options.forbiddenWords) ??
      findEntityIssue(line.analysis, options.forbiddenEntities);
    if (safetyIssue !== undefined) {
      return {
        ok: false,
        stage: 5,
        reason: `analysis contains ${safetyIssue}`,
      };
    }
  }

  return {
    ok: true,
    output: lines.map((line) => ({
      candidateId: line.candidateId,
      analysis: line.analysis,
      ...(line.actionId === undefined
        ? {}
        : { actionId: line.actionId as InsightActionId }),
    })),
  };
}

/**
 * Asserts that an outbound provider payload is privacy-safe before it is
 * serialized and sent. The candidate `fact` sentences are the only user data;
 * they may contain digits but must never carry secrets, URLs, absolute paths,
 * commands, prompt injection, or caller-declared entity names.
 *
 * Throws `Error` with a one-line reason; the generator catches this and maps it
 * to a `failed` result without ever calling the model.
 */
export function assertPayloadSafe(
  payload: unknown,
  options: AssertPayloadSafeOptions = {},
): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(payload) ?? "";
  } catch {
    throw new Error("payload is not JSON-serializable");
  }
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error("payload exceeds the size limit");
  }
  const issue =
    findSecretIssue(serialized) ??
    findUrlIssue(serialized) ??
    findPathIssue(serialized) ??
    findCommandIssue(serialized) ??
    findInjectionIssue(serialized) ??
    findEntityIssue(serialized, options.forbiddenEntities);
  if (issue !== undefined) {
    throw new Error(`payload contains ${issue}`);
  }
}
