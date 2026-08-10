import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import type { UsageSnapshotDto, SnapshotRepository } from "../contracts.ts";

/** Adapts the shared atomic JSON store without choosing a user data path. */
export function createAtomicSnapshotRepository(
  store: AtomicJsonStore<UsageSnapshotDto>,
): SnapshotRepository {
  return {
    async load() {
      return (await store.read()).value;
    },
    async save(snapshot) {
      await store.write(snapshot);
    },
  };
}

/** Same atomic adapter for the production empty-state document. JSON cannot
 * represent `undefined`, so the on-disk absence sentinel is `null`; callers
 * still receive the domain's `undefined` for "no snapshot yet". */
export function createNullableAtomicSnapshotRepository(
  store: AtomicJsonStore<UsageSnapshotDto | null>,
): SnapshotRepository {
  return {
    async load() {
      return (await store.read()).value ?? undefined;
    },
    async save(snapshot) {
      await store.write(snapshot);
    },
  };
}
