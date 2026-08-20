import assert from "node:assert/strict";
import test from "node:test";

import {
  createExchangeRateRepository,
  type ExchangeRateCache,
} from "./exchange-rate.server.ts";

const LIVE_RATES = {
  date: "2026-08-05",
  rates: { CNY: 7.15, JPY: 146, KRW: 1360 },
};

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

function failingFetcher(): typeof fetch {
  return async () => {
    throw new Error("network down");
  };
}

test("汇率: 24 小时内 readCache 不发起网络请求", async () => {
  const cache = memoryCache();
  let fetches = 0;
  const repo = createExchangeRateRepository({
    fetcher: async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), { status: 200 });
    },
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  await repo.refresh();
  const next = await repo.readCache();
  assert.equal(next.source, "cache");
  assert.equal(next.stale, false);
  assert.equal(fetches, 1);
});

test("汇率: 23:59 缓存仍新鲜,不尝试网络", async () => {
  const cache = memoryCache();
  const repo = createExchangeRateRepository({
    fetcher: jsonFetcher(LIVE_RATES),
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  await repo.refresh();
  const late = createExchangeRateRepository({
    fetcher: failingFetcher(),
    now: () => new Date("2026-08-05T23:59:00Z"),
    cache,
  });
  // readCache never fetches; even a failing fetcher is never called.
  const snapshot = await late.readCache();
  assert.equal(snapshot.source, "cache");
});

test("汇率: 超过 24 小时后 stale,先返回 stale-cache 再后台刷新", async () => {
  const cache = memoryCache();
  const fresh = createExchangeRateRepository({
    fetcher: jsonFetcher(LIVE_RATES),
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  await fresh.refresh();

  const nextDay = createExchangeRateRepository({
    fetcher: jsonFetcher(LIVE_RATES),
    now: () => new Date("2026-08-06T10:30:00Z"),
    cache,
  });
  const stale = await nextDay.readCache();
  assert.equal(stale.source, "stale-cache");
  assert.equal(stale.stale, true);
  assert.equal(stale.rates.CNY, 7.15);

  const refreshed = await nextDay.refresh();
  assert.equal(refreshed.source, "live");
  assert.equal(refreshed.stale, false);
});

test("汇率: 离线失败保留 last-known-good(stale-cache)", async () => {
  const cache = memoryCache();
  const fresh = createExchangeRateRepository({
    fetcher: jsonFetcher(LIVE_RATES),
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  await fresh.refresh();

  const offline = createExchangeRateRepository({
    fetcher: failingFetcher(),
    now: () => new Date("2026-08-07T10:00:00Z"),
    cache,
  });
  const result = await offline.refresh();
  assert.equal(result.source, "stale-cache");
  assert.equal(result.rates.CNY, 7.15);
});

test("汇率: 无缓存且离线 → 内建 fallback", async () => {
  const cache = memoryCache();
  const repo = createExchangeRateRepository({
    fetcher: failingFetcher(),
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  const result = await repo.readCache();
  assert.equal(result.source, "fallback");
  assert.ok(result.rates.CNY > 0);
  assert.equal(result.rates.USD, 1);
});

test("汇率: SQLite 写入失败直接上抛，不回退为缓存结果", async () => {
  const cache: ExchangeRateCache = {
    async read() {
      return undefined;
    },
    async write() {
      throw new Error("sqlite write failed");
    },
  };
  const repo = createExchangeRateRepository({
    fetcher: jsonFetcher(LIVE_RATES),
    now: () => new Date("2026-08-05T10:00:00Z"),
    cache,
  });
  await assert.rejects(repo.refresh(), /sqlite write failed/);
});
