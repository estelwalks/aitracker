import type {
  LogAttributes,
  ObservationInput,
  ObservationLogEntry,
} from "./contracts.ts";

const FORBIDDEN_FIELD_NAMES = new Set([
  "command",
  "resumecommand",
  "content",
  "rawcontent",
  "prompt",
  "response",
  "messages",
  "transcript",
  "sessionbody",
  "apikey",
  "api_key",
  "token",
  "accesstoken",
  "authorization",
  "password",
  "secret",
]);

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bghp_[A-Za-z0-9]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
];
const ABSOLUTE_PATH_PATTERN = /(?:^|\s)(?:\/[\S]+|[A-Za-z]:[\\/][\S]*)/;
const COMMAND_PATTERN =
  /(?:^|\s)(?:node|npm|npx|pnpm|yarn|bash|sh|zsh|cmd(?:\.exe)?|powershell)(?:\s|$)/i;
const SAFE_IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SAFE_ERROR_CODE = /^errors\.[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function isForbiddenValue(value: string): boolean {
  return (
    ABSOLUTE_PATH_PATTERN.test(value) ||
    COMMAND_PATTERN.test(value) ||
    CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value))
  );
}

/** Removes dangerous metadata rather than preserving a sensitive field name. */
export function redactAttributes(
  attributes: LogAttributes | undefined,
): ObservationLogEntry["attributes"] {
  if (!attributes) return undefined;

  const redacted: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (FORBIDDEN_FIELD_NAMES.has(key.toLowerCase()) || value === undefined) {
      continue;
    }
    if (typeof value === "string" && isForbiddenValue(value)) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return Object.keys(redacted).length > 0 ? redacted : undefined;
}

/** Ensures identifiers are code-like values before they become durable logs. */
function requireSafeIdentifier(value: string, field: string): string {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new TypeError(`${field} must be a stable dotted identifier`);
  }
  return value;
}

/**
 * Produces the only log DTO accepted by the Node JSONL writer. Any caller
 * needing textual diagnostics must map it to a stable event/error code first.
 */
export function redactObservation(
  input: ObservationInput,
  timestamp: string,
): ObservationLogEntry {
  requireSafeIdentifier(input.event, "event");
  requireSafeIdentifier(input.module, "module");
  if (input.errorCode && !SAFE_ERROR_CODE.test(input.errorCode)) {
    throw new TypeError("errorCode must be a stable errors.* identifier");
  }
  if (
    input.durationMs !== undefined &&
    (!Number.isFinite(input.durationMs) || input.durationMs < 0)
  ) {
    throw new TypeError("durationMs must be a non-negative finite number");
  }
  return {
    timestamp,
    level: input.level,
    event: input.event,
    module: input.module,
    taskId: input.taskId ?? null,
    runId: input.runId ?? null,
    correlationId: input.correlationId ?? null,
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
    outcome: input.outcome,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(redactAttributes(input.attributes)
      ? { attributes: redactAttributes(input.attributes) }
      : {}),
  };
}
