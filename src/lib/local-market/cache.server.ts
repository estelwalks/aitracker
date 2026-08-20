import type { MarketListResult } from "./types.ts";

const SQLITE_NAMESPACE = "skill-market";
const SQLITE_TTL_MS = 30 * 60 * 1_000;

export function marketCacheKey(
  page: number,
  limit: number,
  search: string,
  sort?: string,
  tags?: string,
): string {
  return `${page}:${limit}:${search.toLocaleLowerCase()}:${sort ?? "stars"}:${tags ?? ""}`;
}

export async function readMarketCache(
  key: string,
): Promise<MarketListResult | null> {
  const cache = await resolveSqliteCache();
  return (
    (await cache.get<MarketListResult>(SQLITE_NAMESPACE, key))?.payload ?? null
  );
}

export async function writeMarketCache(
  key: string,
  result: MarketListResult,
): Promise<void> {
  const fetchedAtMs = Date.parse(result.fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) {
    throw new TypeError("Market cache fetchedAt is invalid");
  }
  const cache = await resolveSqliteCache();
  await cache.put({
    namespace: SQLITE_NAMESPACE,
    key,
    payload: result,
    fetchedAtMs,
    expiresAtMs: fetchedAtMs + SQLITE_TTL_MS,
  });
}

async function resolveSqliteCache() {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return (await getCompositionRoot()).database.features.httpCache;
}
