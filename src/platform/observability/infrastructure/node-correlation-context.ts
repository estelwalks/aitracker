import { AsyncLocalStorage } from "node:async_hooks";

import type {
  CorrelationContext,
  CorrelationContextValue,
} from "../contracts.ts";

/** Node adapter that preserves operation identity across Promise boundaries. */
export class NodeCorrelationContext implements CorrelationContext {
  private readonly storage = new AsyncLocalStorage<CorrelationContextValue>();

  current(): CorrelationContextValue | undefined {
    return this.storage.getStore();
  }

  run<T>(value: CorrelationContextValue, operation: () => T): T {
    return this.storage.run(value, operation);
  }
}
