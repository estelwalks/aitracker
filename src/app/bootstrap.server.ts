import {
  createNodeRuntimeIdentity,
  type RuntimeIdentity,
} from "../platform/runtime";
import type { TaskScheduler } from "../modules/tasks/application/scheduler.ts";
import { getCompositionRoot } from "./composition.server.ts";

/**
 * Lifecycle port for the future scheduler and other background services.
 * Implementations are server-only and must not construct React state.
 */
export interface BackgroundRuntime {
  start(): void | Promise<void>;
  /** Optional for backwards-compatible adapters; bootstrap stop is always safe. */
  stop?(): void | Promise<void>;
}

export type BackgroundRuntimeStartResult =
  | {
      readonly status: "disabled";
      readonly reason: RuntimeIdentity["backgroundTasksReason"];
    }
  | {
      readonly status: "started";
      readonly reason: RuntimeIdentity["backgroundTasksReason"];
    };

export interface BackgroundRuntimeBootstrapDependencies {
  readonly getRuntimeIdentity: () => RuntimeIdentity;
  readonly createBackgroundRuntime: () => BackgroundRuntime;
}

export interface BackgroundRuntimeBootstrap {
  /** Idempotent even when callers race during the first SSR request. */
  ensureStarted(): Promise<BackgroundRuntimeStartResult>;
  /** Explicit shutdown hook. It is idempotent and never exposes raw errors. */
  stop(): Promise<void>;
}

export class BackgroundRuntimeBootstrapError extends Error {
  readonly code = "errors.runtime.bootstrap-failed" as const;

  constructor(cause?: unknown) {
    super("Background runtime failed to start");
    this.name = "BackgroundRuntimeBootstrapError";
    // Keep the original failure available to server-side diagnostics without
    // serializing it into a response or persisting it in public DTOs.
    if (cause !== undefined)
      Object.defineProperty(this, "cause", { value: cause });
  }
}

/** Adapts the scheduler port without coupling the composition root to storage. */
export function createSchedulerBackgroundRuntime(
  scheduler: Pick<TaskScheduler, "start" | "stop">,
): BackgroundRuntime {
  return {
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
  };
}

/**
 * Creates an isolated bootstrapper so production composition and tests do not
 * share a hidden process singleton. The production singleton is below.
 */
export function createBackgroundRuntimeBootstrap(
  dependencies: BackgroundRuntimeBootstrapDependencies,
): BackgroundRuntimeBootstrap {
  let startPromise: Promise<BackgroundRuntimeStartResult> | undefined;
  let runtime: BackgroundRuntime | undefined;
  let stopPromise: Promise<void> | undefined;

  return {
    ensureStarted() {
      if (startPromise) return startPromise;

      const identity = dependencies.getRuntimeIdentity();
      if (!identity.backgroundTasksEnabled) {
        startPromise = Promise.resolve({
          status: "disabled",
          reason: identity.backgroundTasksReason,
        });
        return startPromise;
      }

      startPromise = Promise.resolve()
        .then(() => {
          const candidate = dependencies.createBackgroundRuntime();
          runtime = candidate;
          return candidate.start();
        })
        .then(() => ({
          status: "started" as const,
          reason: identity.backgroundTasksReason,
        }))
        .catch((error: unknown) => {
          // Permit a later request to retry an unavailable runtime. A failed
          // promise must never permanently poison the composition root.
          startPromise = undefined;
          runtime = undefined;
          throw new BackgroundRuntimeBootstrapError(error);
        });
      return startPromise;
    },
    async stop() {
      if (stopPromise) return stopPromise;
      stopPromise = (async () => {
        const pending = startPromise;
        if (pending) {
          try {
            await pending;
          } catch {
            // A failed start already reset the state; there is nothing to stop.
            return;
          }
        }
        const current = runtime;
        if (!current?.stop) return;
        await current.stop();
        runtime = undefined;
        startPromise = undefined;
      })().finally(() => {
        stopPromise = undefined;
      });
      return stopPromise;
    },
  };
}

/**
 * Production background runtime. Lazily resolves the composition root (which
 * constructs the scheduler and its repositories on first call) and forwards
 * lifecycle to the real scheduler.
 *
 * The composition root is only built once a request reaches this runtime's
 * `start` — and `ensureStarted` only calls `start` when
 * `RuntimeIdentity.backgroundTasksEnabled` is true — so Web dev mode (where
 * background tasks are disabled by policy) never triggers the scheduler or its
 * data-root I/O. `stop` reuses the idempotent singleton, which resolves without
 * reconstruction since bootstrap only stops after a successful start.
 */
function createCompositionBackgroundRuntime(): BackgroundRuntime {
  return {
    start: async () => {
      const { scheduler, monitoring } = await getCompositionRoot();
      await monitoring.start();
      try {
        await scheduler.start();
      } catch (error) {
        await monitoring.stop();
        throw error;
      }
    },
    stop: async () => {
      const { scheduler, monitoring } = await getCompositionRoot();
      await scheduler.stop();
      await monitoring.stop();
    },
  };
}

const productionBootstrap = createBackgroundRuntimeBootstrap({
  getRuntimeIdentity: createNodeRuntimeIdentity,
  createBackgroundRuntime: createCompositionBackgroundRuntime,
});

/**
 * Server composition entrypoint. Calling it is harmless in Web development:
 * RuntimeIdentity resolves that mode to the disabled policy by default.
 */
export function ensureBackgroundRuntimeStarted(): Promise<BackgroundRuntimeStartResult> {
  return productionBootstrap.ensureStarted();
}
