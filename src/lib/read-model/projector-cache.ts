/**
 * Bounded revision-keyed projector cache (P1-T1-01).
 *
 * Projectors memoize by `snapshotRevision + pageParams` with a bounded number
 * of entries. When the revision changes the old projections are naturally
 * invalidated (evicted LRU-first); a stale entry is never returned for a
 * different revision. The cache only stores compact projections — never raw
 * events or arbitrary function results.
 */

export interface ProjectorCacheKey {
  readonly revision: string | null;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ProjectorCacheEntry<T> {
  readonly key: ProjectorCacheKey;
  readonly value: T;
  readonly createdAtMs: number;
}

export interface ProjectorCacheOptions {
  /** Maximum number of cached projections (LRU eviction). */
  readonly maxEntries?: number;
  readonly now?: () => number;
}

export interface ProjectorCache<T> {
  /** Returns the cached projection for a key, or undefined on miss. */
  get(
    revision: string | null,
    params?: ProjectorCacheKey["params"],
  ): T | undefined;
  /** Caches a projection; evicts LRU entries beyond `maxEntries`. */
  set(
    revision: string | null,
    params: ProjectorCacheKey["params"],
    value: T,
  ): void;
  /** Drops everything (e.g. after a policy change). */
  clear(): void;
  readonly size: number;
}

export function createProjectorCache<T>(
  options: ProjectorCacheOptions = {},
): ProjectorCache<T> {
  const maxEntries = options.maxEntries ?? 16;
  const now = options.now ?? Date.now;
  const entries = new Map<
    string,
    { key: ProjectorCacheKey; value: T; createdAtMs: number }
  >();

  function keyOf(revision: string | null, params: ProjectorCacheKey["params"]) {
    const stableParams = Object.keys(params ?? {})
      .sort()
      .map((key) => `${key}=${String(params![key])}`)
      .join(",");
    return `${revision ?? ""}#${stableParams}`;
  }

  return {
    get(revision, params = {}) {
      const key = keyOf(revision, params);
      const entry = entries.get(key);
      if (!entry) return undefined;
      // Re-insert to mark as most-recently-used.
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(revision, params, value) {
      const key = keyOf(revision, params);
      entries.delete(key);
      entries.set(key, {
        key: { revision, params },
        value,
        createdAtMs: now(),
      });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
