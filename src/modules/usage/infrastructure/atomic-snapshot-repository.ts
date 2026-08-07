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
