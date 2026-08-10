import type { MessageKey } from "./i18n/messages";

/**
 * Server-fn error convention: throw an `AppError` with a stable message key
 * instead of a Chinese/English sentence. TanStack Start serializes only the
 * `message` field across the RPC boundary, so we pack `{ code, params }` as
 * JSON there and reconstruct it on the client with `toUiError`.
 */
export class AppError extends Error {
  readonly code: MessageKey;
  readonly params?: Record<string, string | number>;

  constructor(code: MessageKey, params?: Record<string, string | number>) {
    super(JSON.stringify({ code, params }));
    this.name = "AppError";
    this.code = code;
    this.params = params;
  }
}

/**
 * Extract the UI-facing error code from any thrown value. Returns null for
 * non-AppError errors (callers fall back to `t("common.error")` rather than
 * leaking raw server messages into toasts).
 */
export function toUiError(
  error: unknown,
): { code: MessageKey; params?: Record<string, string | number> } | null {
  if (error instanceof AppError) {
    return { code: error.code, params: error.params };
  }
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message) as {
        code?: unknown;
        params?: unknown;
      };
      if (typeof parsed?.code === "string") {
        return {
          code: parsed.code as MessageKey,
          params:
            parsed.params != null &&
            typeof parsed.params === "object" &&
            !Array.isArray(parsed.params)
              ? (parsed.params as Record<string, string | number>)
              : undefined,
        };
      }
    } catch {
      // message is not an AppError payload
    }
  }
  return null;
}
