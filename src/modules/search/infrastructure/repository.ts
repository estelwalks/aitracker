import type {
  AtomicJsonStore,
  Clock,
} from "../../../platform/persistence/contracts.ts";
import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  SearchIndexRepository,
  SearchIndexSnapshot,
} from "../contracts.ts";
import { createSnapshot } from "../domain.ts";

export function createSearchIndexRepository(options: {
  readonly store: AtomicJsonStore<SearchIndexSnapshot>;
  readonly clock: Clock;
}): SearchIndexRepository {
  return {
    async read(): Promise<Result<SearchIndexSnapshot>> {
      try {
        const result = await options.store.read();
        return ok(result.value);
      } catch {
        return ok(createSnapshot([], options.clock.now().toISOString(), true));
      }
    },
    async write(snapshot): Promise<Result<void>> {
      try {
        await options.store.write(snapshot);
        return ok(undefined);
      } catch {
        return err("errors.search.persistenceFailed");
      }
    },
  };
}
