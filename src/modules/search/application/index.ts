import type { Clock } from "../../../platform/persistence/contracts.ts";
import type {
  EventBus,
  CoreEventMap,
  Unsubscribe,
} from "../../../shared/events.ts";
import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  SearchDocument,
  SearchIndexRepository,
  SearchIndexSnapshot,
  SearchQuery,
  SearchQueryResult,
} from "../contracts.ts";
import { createSnapshot, querySnapshot } from "../domain.ts";

export class SearchIndexService {
  private snapshot: SearchIndexSnapshot;
  private readonly byId = new Map<string, SearchDocument>();
  constructor(
    private readonly repository: SearchIndexRepository,
    private readonly clock: Clock,
    initial?: SearchIndexSnapshot,
  ) {
    this.snapshot =
      initial ?? createSnapshot([], this.clock.now().toISOString());
    for (const document of this.snapshot.documents)
      this.byId.set(document.id, document);
  }
  async load(): Promise<Result<SearchIndexSnapshot>> {
    const result = await this.repository.read();
    if (result.ok) {
      this.snapshot = result.value;
      this.byId.clear();
      for (const document of result.value.documents)
        this.byId.set(document.id, document);
    }
    return result;
  }
  getSnapshot(): SearchIndexSnapshot {
    return this.snapshot;
  }
  async upsert(document: SearchDocument): Promise<Result<SearchIndexSnapshot>> {
    this.byId.set(document.id, document);
    return this.persist();
  }
  async remove(id: string): Promise<Result<SearchIndexSnapshot>> {
    this.byId.delete(id);
    return this.persist();
  }
  async rebuildFromSnapshots(
    documents: readonly SearchDocument[],
    stale = false,
  ): Promise<Result<SearchIndexSnapshot>> {
    this.byId.clear();
    for (const document of documents) this.byId.set(document.id, document);
    return this.persist(stale);
  }
  query(input: SearchQuery): SearchQueryResult {
    return querySnapshot(this.snapshot, input);
  }
  private async persist(stale = false): Promise<Result<SearchIndexSnapshot>> {
    const next = createSnapshot(
      [...this.byId.values()],
      this.clock.now().toISOString(),
      stale,
    );
    const written = await this.repository.write(next);
    if (!written.ok) return err(written.error.code, written.error.params);
    this.snapshot = next;
    return ok(next);
  }
}

export interface SearchEventProjection {
  dispose(): void;
}

/** Event invalidation is intentionally supplied a public DTO by its owner. */
export function createSearchEventProjection(options: {
  readonly events: EventBus<CoreEventMap>;
  readonly onSnapshotUpdated: (module: string) => void;
}): SearchEventProjection {
  const unsubscribe: Unsubscribe[] = [];
  unsubscribe.push(
    options.events.subscribe("snapshot.updated", (event) =>
      options.onSnapshotUpdated(event.module),
    ),
  );
  return { dispose: () => unsubscribe.splice(0).forEach((cancel) => cancel()) };
}
