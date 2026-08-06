import {
  createNodeRuntimeIdentity,
  type RuntimeIdentity,
} from "../platform/runtime";

/**
 * Lifecycle port for the future scheduler and other background services.
 * Implementations are server-only and must not construct React state.
 */
export interface BackgroundRuntime {
  start(): void | Promise<void>;
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
}

/**
 * Creates an isolated bootstrapper so production composition and tests do not
 * share a hidden process singleton. The production singleton is below.
 */
export function createBackgroundRuntimeBootstrap(
  dependencies: BackgroundRuntimeBootstrapDependencies,
): BackgroundRuntimeBootstrap {
  let startPromise: Promise<BackgroundRuntimeStartResult> | undefined;

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

      startPromise = Promise.resolve(
        dependencies.createBackgroundRuntime().start(),
      )
        .then(() => ({
          status: "started" as const,
          reason: identity.backgroundTasksReason,
        }))
        .catch((error: unknown) => {
          // Permit a later request to retry an unavailable runtime. A failed
          // promise must never permanently poison the composition root.
          startPromise = undefined;
          throw error;
        });
      return startPromise;
    },
  };
}

/**
 * Placeholder runtime for P1. It deliberately performs no collection or
 * scheduling; P3 replaces this factory with the task scheduler adapter.
 */
function createEmptyBackgroundRuntime(): BackgroundRuntime {
  return { start: () => undefined };
}

const productionBootstrap = createBackgroundRuntimeBootstrap({
  getRuntimeIdentity: createNodeRuntimeIdentity,
  createBackgroundRuntime: createEmptyBackgroundRuntime,
});

/**
 * Server composition entrypoint. Calling it is harmless in Web development:
 * RuntimeIdentity resolves that mode to the disabled policy by default.
 */
export function ensureBackgroundRuntimeStarted(): Promise<BackgroundRuntimeStartResult> {
  return productionBootstrap.ensureStarted();
}
