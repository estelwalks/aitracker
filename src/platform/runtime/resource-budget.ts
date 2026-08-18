import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";

/**
 * P5-T5-05: cancellable resource budget.
 *
 * A semaphore that never queues indefinitely: waiting acquires reject with a
 * cancellation error when their signal aborts (timeout or user cancel).
 * Permits are always released on completion or cancellation, so a cancelled
 * task can never leak a permit. Limits come from the public runtime policy
 * (`resourceBudgets`): heavy collectors = 1, file operations = 16,
 * project classifiers = 8.
 */

export type ResourceClass = "heavy" | "file" | "classifier";

export const RESOURCE_CLASS_ORDER: readonly ResourceClass[] = [
  "heavy",
  "file",
  "classifier",
];

export function resourceLimitFor(
  resource: ResourceClass,
  policy: typeof RUNTIME_POLICY = RUNTIME_POLICY,
): number {
  switch (resource) {
    case "heavy":
      return policy.resourceBudgets.maxHeavyCollectors;
    case "file":
      return policy.resourceBudgets.maxFileOperations;
    case "classifier":
      return policy.resourceBudgets.maxProjectClassifiers;
  }
}

export interface ResourceBudget {
  /** Acquires one permit of the class; rejects with CancelledError on abort. */
  acquire(resource: ResourceClass, signal?: AbortSignal): Promise<() => void>;
  /** Current in-flight count per class (diagnostics). */
  inFlight(resource: ResourceClass): number;
  /** Snapshot of all classes (diagnostics). */
  snapshot(): Readonly<Record<ResourceClass, number>>;
}

export class ResourceBudgetExhaustedError extends Error {
  readonly name = "ResourceBudgetExhaustedError";
  constructor(readonly resource: ResourceClass) {
    super(`resource budget exhausted: ${resource}`);
  }
}

export function createResourceBudget(
  limits?: Partial<Record<ResourceClass, number>>,
): ResourceBudget {
  const inFlight = new Map<ResourceClass, number>(
    RESOURCE_CLASS_ORDER.map((resource) => [resource, 0]),
  );
  const waiters = new Map<ResourceClass, Array<() => void>>(
    RESOURCE_CLASS_ORDER.map((resource) => [resource, []]),
  );

  const release = (resource: ResourceClass): void => {
    const current = inFlight.get(resource) ?? 0;
    inFlight.set(resource, Math.max(0, current - 1));
    const queue = waiters.get(resource) ?? [];
    const next = queue.shift();
    if (next) next();
  };

  return {
    async acquire(resource, signal) {
      const limit = limits?.[resource] ?? resourceLimitFor(resource);
      const current = inFlight.get(resource) ?? 0;
      if (current < limit) {
        inFlight.set(resource, current + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          release(resource);
        };
      }
      // Wait for a permit, but abort promptly when the signal fires.
      return new Promise<() => void>((resolve, reject) => {
        const queue = waiters.get(resource) ?? [];
        const onAbort = () => {
          const index = queue.indexOf(step);
          if (index >= 0) queue.splice(index, 1);
          reject(new Error("resource-acquire-cancelled"));
        };
        const step = () => {
          signal?.removeEventListener("abort", onAbort);
          const permit = inFlight.get(resource) ?? 0;
          inFlight.set(resource, permit + 1);
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            release(resource);
          });
        };
        if (signal?.aborted) {
          reject(new Error("resource-acquire-cancelled"));
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        queue.push(step);
      });
    },
    inFlight(resource) {
      return inFlight.get(resource) ?? 0;
    },
    snapshot() {
      return {
        heavy: inFlight.get("heavy") ?? 0,
        file: inFlight.get("file") ?? 0,
        classifier: inFlight.get("classifier") ?? 0,
      };
    },
  };
}
