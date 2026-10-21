import { APP_NAME, APP_VERSION, STORAGE_KEY_PREFIX } from "./app-config";

/**
 * Renderer-side diagnostics for the route error boundaries.
 *
 * The value of a load failure is entirely in its cause, so the boundary keeps
 * the original error text instead of collapsing it into "page failed to load".
 * Records stay on this machine: a small ring buffer in `localStorage` survives
 * a restart, and the formatted report can be copied out by hand. Nothing here
 * talks to the network, and no business data is included — only the error, the
 * route it happened on and the resolved preferences.
 */

const DIAGNOSTICS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}error-diagnostics.v1`;
const KEEP_RECORDS = 20;
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

export interface DiagnosticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

/** Best-effort persistence — locked-down storage must never mask the error. */
export function storeErrorRecord(
  record: RenderErrorRecord,
  storage?: DiagnosticsStorage,
): readonly RenderErrorRecord[] {
  const target =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (target == null) return [];
  try {
    const existing = readErrorRecords(target);
    const next = [...existing, record].slice(-KEEP_RECORDS);
    target.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

export function readErrorRecords(
  storage?: DiagnosticsStorage,
): readonly RenderErrorRecord[] {
  const target =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (target == null) return [];
  try {
    const raw = target.getItem(DIAGNOSTICS_STORAGE_KEY);
    if (raw == null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as RenderErrorRecord[]).filter(
          (item) => item != null && typeof item === "object",
        )
      : [];
  } catch {
    // Corrupt or unavailable storage degrades to "no history".
    return [];
  }
}

export function clearErrorRecords(storage?: DiagnosticsStorage): void {
  const target =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (target == null) return;
  try {
    target.setItem(DIAGNOSTICS_STORAGE_KEY, "[]");
  } catch {
    // Ignore: clearing history is best effort.
  }
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
