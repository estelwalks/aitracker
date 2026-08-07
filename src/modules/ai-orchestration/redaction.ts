import type {
  AIExecutionResult,
  AIExecutionSummary,
  AIInput,
  AIResponse,
} from "./contracts.ts";

const SENSITIVE_KEY =
  /(?:token|secret|api.?key|password|credential|authorization|prompt|response|content|transcript|command|path)/i;
const POSIX_PATH = /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\)[^\s]+/g;

/** Stable marker-based redaction for diagnostics. It is intentionally not reversible. */
export function redactText(value: string): string {
  return value
    .replace(POSIX_PATH, " [REDACTED_PATH]")
    .replace(/(?:sk|pk)-[A-Za-z0-9_-]{12,}/g, "[REDACTED_KEY]")
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{24,}\b/gi, "[REDACTED_TOKEN]");
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY.test(key)
        ? "[REDACTED]"
        : redactUnknown(nested);
    }
    return output;
  }
  return value;
}

export function redactInput(input: AIInput): AIInput {
  return {
    text: redactText(input.text),
    variables: input.variables
      ? (redactUnknown(input.variables) as Record<string, unknown>)
      : undefined,
  };
}

export function redactResponse(response: AIResponse): AIResponse {
  return { ...response, text: "[REDACTED_OUTPUT]", usage: undefined };
}

export function toPublicExecutionSummary(
  result: AIExecutionResult,
): AIExecutionSummary {
  return result.summary;
}

/** Alias with an explicit boundary name for transport adapters. */
export function toPublicExecutionResult(
  result: AIExecutionResult,
): AIExecutionSummary {
  return toPublicExecutionSummary(result);
}
