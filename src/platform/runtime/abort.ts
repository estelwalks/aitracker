/**
 * P5-T5-01: AbortSignal composition helpers.
 *
 * Distinguishes user-cancel, timeout and collector failure so run records and
 * diagnostics carry stable error codes. `combineSignals` merges a parent
 * (user/task) signal with a timeout signal; aborting either aborts the child.
 */

export type AbortCause = "user" | "timeout" | "unknown";

export class CancelledError extends Error {
  readonly name = "CancelledError";
  constructor(readonly cause: AbortCause = "user") {
    super(cause === "timeout" ? "operation timed out" : "operation cancelled");
  }
}

export interface CombinedSignal {
  readonly signal: AbortSignal;
  /** Releases the timeout timer and listeners; call in finally. */
  dispose(): void;
  /** Resolves the abort cause; "timeout" when the timer fired first. */
  readonly cause: AbortCause;
}

/**
 * Combines a parent signal with a wall-clock timeout. The returned signal
 * aborts when either fires; `dispose()` must be called in `finally` to release
 * the timer and listeners.
 */
export function withTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
  options: {
    readonly setTimeout?: typeof setTimeout;
    readonly clearTimeout?: typeof clearTimeout;
  } = {},
): CombinedSignal {
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const controller = new AbortController();
  let cause: AbortCause = "unknown";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onParentAbort = () => {
    if (controller.signal.aborted) return;
    cause = "user";
    controller.abort();
  };
  const onTimeout = () => {
    if (controller.signal.aborted) return;
    cause = "timeout";
    controller.abort();
  };

  if (parent?.aborted) {
    cause = "user";
    controller.abort();
  } else {
    parent?.addEventListener("abort", onParentAbort, { once: true });
    timer = setTimer(onTimeout, timeoutMs);
  }

  return {
    signal: controller.signal,
    get cause() {
      return cause;
    },
    dispose() {
      if (timer !== undefined) clearTimer(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
  };
}

/** True when an error is a cancellation (AbortError or CancelledError). */
export function isCancellation(error: unknown): boolean {
  return (
    error instanceof CancelledError ||
    (error instanceof Error && error.name === "AbortError") ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}
