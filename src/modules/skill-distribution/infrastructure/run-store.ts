import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import type { DistributionRun, DistributionRunStore } from "../contracts.ts";

export interface DistributionRunDocument {
  readonly schemaVersion: 1;
  readonly runs: readonly DistributionRun[];
}

/** Durable audit projection; the store remains an injected AtomicJsonStore. */
export function createDistributionRunStore(
  store: AtomicJsonStore<DistributionRunDocument>,
): DistributionRunStore {
  return {
    async append(run) {
      const current = await store.read();
      await store.write({
        schemaVersion: 1,
        runs: [...current.value.runs, run].slice(-500),
      });
    },
  };
}
