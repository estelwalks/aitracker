import assert from "node:assert/strict";
import test from "node:test";

import {
  createExchangeRateRepository,
  type ExchangeRateCache,
} from "../../platform/snapshot-runtime/exchange-rate.server.ts";
import { performExchangeRateRefresh } from "./server-fns.ts";

/**
 * Deterministic tests for the manual exchange-rate refresh outcome
 * (P1-1 regression). The repository is injected with an in-memory cache, a
 * fixed clock and a scripted fetcher — no real network, no SQLite, no task
 * scheduler. The task runtime is modelled by the `runRefresh` dependency the
 * way the `exchange.refresh` executor behaves: an online run rewrites the
 * shared http-cache (like `repository.refresh()` does inside the composition
 * root), an offline run leaves last-known-good untouched.
 */

const ROWS_2026_08_05 = [
  { date: "2026-08-05", base: "USD", quote: "CNY", rate: 7.15 },
  { date: "2026-08-05", base: "USD", quote: "JPY", rate: 146 },
  { date: "2026-08-05", base: "USD", quote: "KRW", rate: 1360 },
];

const ROWS_2026_08_07 = [
  { date: "2026-08-07", base: "USD", quote: "CNY", rate: 7.3 },
  { date: "2026-08-07", base: "USD", quote: "JPY", rate: 150 },
  { date: "2026-08-07", base: "USD", quote: "KRW", rate: 1400 },
];

const T0 = new Date("2026-08-05T10:00:00.000Z");
const T1 = new Date("2026-08-07T10:00:00.000Z"); // 48h later: T0 cache is stale
const T2 = new Date("2026-08-05T11:00:00.000Z"); // +1h: T0 cache still fresh

function memoryCache(): ExchangeRateCache {
  let value: Awaited<ReturnType<ExchangeRateCache["read"]>>;
  return {
    async read() {
      return value;
    },
    async write(next) {
      value = next;
    },
  };
}

function jsonFetcher(payload: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

function offlineFetcher(): typeof fetch {
  return async () => {
    throw new Error("network down");
  };
}

/** Reader with a failing fetcher: any accidental network attempt would throw. */
function cacheReader(cache: ExchangeRateCache, now: Date) {
  return createExchangeRateRepository({
    cache,
    now: () => now,
    fetcher: offlineFetcher(),
  });
}

/** Online writer used to seed the cache or simulate a successful task run. */
function onlineWriter(cache: ExchangeRateCache, now: Date, rows: unknown) {
  return createExchangeRateRepository({
    cache,
    now: () => now,
    fetcher: jsonFetcher(rows),
  });
}

test("online refresh success advances fetchedAt → refreshed=true, read path still labels cache", async () => {
  const cache = memoryCache();
  // A previous online session wrote rates that are stale by T1.
  await onlineWriter(cache, T0, ROWS_2026_08_05).refresh();

  const outcome = await performExchangeRateRefresh({
    readCache: () => cacheReader(cache, T1).readCache(),
    // Simulates the `exchange.refresh` executor writing the http-cache.
    runRefresh: async () => {
      await onlineWriter(cache, T1, ROWS_2026_08_07).refresh();
    },
  });

  assert.equal(outcome.refreshed, true);
  // The cache-only read that follows a refresh never claims "live"; the
  // outcome marker — not `source` — decides the manual-refresh toast.
  assert.equal(outcome.source, "cache");
  assert.equal(outcome.date, "2026-08-07");
  assert.equal(outcome.rates.CNY, 7.3);
  assert.deepEqual(Object.keys(outcome).sort(), [
    "date",
    "rates",
    "refreshed",
    "source",
  ]);
});

test("offline refresh with a stale cache keeps fetchedAt → refreshed=false", async () => {
  const cache = memoryCache();
  await onlineWriter(cache, T0, ROWS_2026_08_05).refresh();

  const outcome = await performExchangeRateRefresh({
    readCache: () => cacheReader(cache, T1).readCache(),
    // Offline run: the executor keeps last-known-good (stale cache), no write.
    runRefresh: async () => {
      await cacheReader(cache, T1).refresh();
    },
  });

  assert.equal(outcome.refreshed, false);
  assert.equal(outcome.source, "stale-cache");
  assert.equal(outcome.date, "2026-08-05");
  assert.equal(outcome.rates.CNY, 7.15);
});

test("offline refresh with an already-fresh cache keeps fetchedAt → refreshed=false", async () => {
  const cache = memoryCache();
  await onlineWriter(cache, T0, ROWS_2026_08_05).refresh();

  const outcome = await performExchangeRateRefresh({
    readCache: () => cacheReader(cache, T2).readCache(),
    // Network fails but the <24h cache is returned untouched ("cache" label).
    runRefresh: async () => {
      await cacheReader(cache, T2).refresh();
    },
  });

  assert.equal(outcome.refreshed, false);
  assert.equal(outcome.source, "cache");
  assert.equal(outcome.rates.CNY, 7.15);
});

test("cold offline refresh (no cache) → refreshed=false with built-in fallback", async () => {
  const cache = memoryCache();

  const outcome = await performExchangeRateRefresh({
    readCache: () => cacheReader(cache, T1).readCache(),
    runRefresh: async () => {
      await cacheReader(cache, T1).refresh();
    },
  });

  assert.equal(outcome.refreshed, false);
  assert.equal(outcome.source, "fallback");
  assert.ok(outcome.rates.CNY > 0);
  assert.equal(outcome.rates.USD, 1);
});

test("read paths keep cache/stale-cache/fallback semantics and never report a refresh marker", async () => {
  const cache = memoryCache();
  // Empty store → built-in fallback.
  const empty = await cacheReader(cache, T0).readCache();
  assert.equal(empty.source, "fallback");
  assert.equal(empty.fetchedAt, null);

  // Seeded store → "cache" while fresh, "stale-cache" after 24h.
  await onlineWriter(cache, T0, ROWS_2026_08_05).refresh();
  const fresh = await cacheReader(cache, T2).readCache();
  assert.equal(fresh.source, "cache");
  assert.equal(fresh.stale, false);

  const stale = await cacheReader(cache, T1).readCache();
  assert.equal(stale.source, "stale-cache");
  assert.equal(stale.stale, true);
  assert.equal(stale.rates.CNY, 7.15);
});

test("an unrecoverable task-runtime error propagates (server-fn fallback handles it)", async () => {
  const cache = memoryCache();
  await onlineWriter(cache, T0, ROWS_2026_08_05).refresh();

  await assert.rejects(
    performExchangeRateRefresh({
      readCache: () => cacheReader(cache, T1).readCache(),
      runRefresh: async () => {
        throw new Error("scheduler down");
      },
    }),
    /scheduler down/,
  );
});
