import { APP_NAME, APP_VERSION } from "./app-config";

/**
 * Renderer-side diagnostics for the route error boundaries.
 *
 * The value of a load failure is entirely in its cause, so the boundary keeps
 * the original error text instead of collapsing it into "page failed to load".
 * The record is derived in memory and the formatted report can be copied out
 * by hand. Nothing here talks to the network or persists browser state:
 * application-owned state belongs in SQLite, and a debug report is not worth
 * an exception.
 */

const MAX_FIELD_LENGTH = 8_000;
const MAX_STACK_LENGTH = 12_000;
const CAUSE_DEPTH_LIMIT = 4;

export interface RenderErrorRecord {
  /** ISO timestamp of the observation. */
  readonly at: string;
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  /** Full cause chain, outermost first. */
  readonly causes?: readonly string[];
  readonly route?: string;
  readonly locale?: string;
  readonly currency?: string;
  readonly appVersion?: string;
  readonly platform?: string;
  readonly userAgent?: string;
  /** `false` when the message was produced by a real `Error` instance. */
  readonly fallback: boolean;
}

/** Optional context the boundary can supply; unavailable values are omitted. */
export interface ErrorDiagnosticsContext {
  readonly route?: string;
  readonly locale?: string;
  readonly currency?: string;
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function describeCause(value: unknown): string {
  if (value instanceof Error) {
    const stack = value.stack ?? `${value.name}: ${value.message}`;
    return clip(stack, MAX_STACK_LENGTH);
  }
  if (typeof value === "string") return clip(value, MAX_FIELD_LENGTH);
  try {
    return clip(JSON.stringify(value) ?? String(value), MAX_FIELD_LENGTH);
  } catch {
    return String(value);
  }
}

/**
 * Collects the error and its `cause` chain. React throws the boundary the
 * original value, which is not always an `Error` — `throw "boom"` and rejected
 * non-error promises reach here as strings or plain objects, so their type and
 * string form are preserved rather than stringified to "undefined".
 */
export function createErrorRecord(
  error: unknown,
  context: ErrorDiagnosticsContext = {},
): RenderErrorRecord {
  const isError = error instanceof Error;
  const name = isError ? error.name : error === null ? "null" : typeof error;
  const message = isError
    ? error.message
    : typeof error === "string"
      ? error
      : describeCause(error);

  const causes: string[] = [];
  if (isError) {
    let current: unknown = error.cause;
    for (
      let depth = 0;
      depth < CAUSE_DEPTH_LIMIT && current != null;
      depth += 1
    ) {
      causes.push(describeCause(current));
      current =
        current instanceof Error
          ? current.cause
          : (current as { cause?: unknown }).cause;
    }
  }

  const platform =
    typeof navigator === "undefined"
      ? undefined
      : ((navigator as Navigator & { userAgentData?: { platform?: string } })
          .userAgentData?.platform ?? navigator.platform);

  return {
    at: new Date().toISOString(),
    name,
    message: clip(message, MAX_FIELD_LENGTH),
    stack: isError
      ? clip(error.stack ?? "", MAX_STACK_LENGTH) || undefined
      : undefined,
    causes: causes.length > 0 ? causes : undefined,
    route:
      context.route ??
      (typeof window === "undefined" ? undefined : window.location.pathname),
    locale: context.locale,
    currency: context.currency,
    appVersion: APP_VERSION,
    platform: platform ?? undefined,
    userAgent:
      typeof navigator === "undefined" ? undefined : navigator.userAgent,
    fallback: !isError,
  };
}

/** Human-readable report: what a bug report should contain. */
export function formatErrorRecord(record: RenderErrorRecord): string {
  const lines = [
    `[${APP_NAME} ${record.appVersion ?? APP_VERSION}] render error`,
    `time: ${record.at}`,
    `route: ${record.route ?? "unknown"}`,
    `locale: ${record.locale ?? "unknown"}   currency: ${record.currency ?? "unknown"}`,
    `platform: ${record.platform ?? "unknown"}`,
    `userAgent: ${record.userAgent ?? "unknown"}`,
    "",
    `${record.name}: ${record.message}`,
  ];
  if (record.causes && record.causes.length > 0) {
    record.causes.forEach((cause, index) => {
      lines.push("", `caused by (${index + 1}): ${cause}`);
    });
  }
  if (record.stack) {
    lines.push("", "stack:", record.stack);
  }
  if (record.fallback) {
    lines.push(
      "",
      "note: the thrown value was not an Error instance; the text above is its",
      "string form, so no stack trace exists.",
    );
  }
  return lines.join("\n");
}

/** Copies text, preferring the async clipboard API of the desktop shell. */
export async function copyDiagnostics(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard != null) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based path.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
