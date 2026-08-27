import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPricingSnapshot } from "./dynamic.server.ts";
import { BUILTIN_RATES } from "./index.ts";
import type { ExchangeRateCache } from "../../platform/snapshot-runtime/exchange-rate.server.ts";

function withTempHome(): string {
  return mkdtempSync(join(tmpdir(), "aitracker-rates-test-"));
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
    throw new Error("network unavailable");
  };
}

const LIVE_RATES = [
  { date: "2026-08-05", base: "USD", quote: "CNY", rate: 7.15 },
  { date: "2026-08-05", base: "USD", quote: "JPY", rate: 146 },
  { date: "2026-08-05", base: "USD", quote: "KRW", rate: 1360 },
];

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

test("汇率: 无缓存 → 内置基准 fallback(页面读取不联网)", async () => {
  const home = withTempHome();
  const cache = memoryCache();
  try {
    const snap = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      fetcher: failingFetcher(),
    });
    assert.equal(snap.exchangeRateSource, "fallback");
    assert.equal(snap.exchangeRates.CNY, BUILTIN_RATES.CNY);
    assert.equal(snap.exchangeRates.JPY, BUILTIN_RATES.JPY);
    assert.equal(snap.exchangeRates.KRW, BUILTIN_RATES.KRW);
    assert.equal(snap.exchangeRates.USD, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: refresh 成功 → live 并写缓存; 随后页面读取走 cache 不重复请求", async () => {
  const home = withTempHome();
  const cache = memoryCache();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    // 后台/手动刷新路径显式请求网络。
    const first = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      fetcher,
      refreshExchange: true,
    });
    assert.equal(first.exchangeRateSource, "live");
    assert.equal(first.exchangeRates.CNY, 7.15);
    assert.equal(first.exchangeRates.JPY, 146);
    assert.equal(first.exchangeRates.KRW, 1360);
    assert.equal(fetches, 1);

    // 页面读取路径 cache-only:缓存新鲜 → cache,不再请求
    const second = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      fetcher,
    });
    assert.equal(second.exchangeRateSource, "cache");
    assert.equal(second.exchangeRates.CNY, 7.15);
    assert.equal(fetches, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 缓存过期后页面读取直接 stale-cache 保留旧值", async () => {
  const home = withTempHome();
  const cache = memoryCache();
  try {
    const now = new Date("2026-08-05T10:00:00Z");
    const fresh = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      now,
      fetcher: jsonFetcher(LIVE_RATES),
      refreshExchange: true,
    });
    assert.equal(fresh.exchangeRateSource, "live");

    // 策略 freshForMinutes=1440(1 天),两天后缓存过期;页面读取 cache-only
    // → stale-cache(绝不因页面读取发起网络)
    let fetches = 0;
    const countingFetcher: typeof fetch = async () => {
      fetches += 1;
      throw new Error("network unavailable");
    };
    const stale = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      now: new Date("2026-08-07T10:00:00Z"),
      fetcher: countingFetcher,
    });
    assert.equal(stale.exchangeRateSource, "stale-cache");
    assert.equal(stale.exchangeRates.CNY, 7.15);
    assert.equal(fetches, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 24 小时内缓存保持新鲜,页面读取不发起网络请求", async () => {
  const home = withTempHome();
  const cache = memoryCache();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      now: new Date("2026-08-05T10:00:00Z"),
      fetcher,
      refreshExchange: true,
    });
    const next = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      now: new Date("2026-08-05T23:59:00Z"),
      fetcher,
    });
    assert.equal(next.exchangeRateSource, "cache");
    assert.equal(fetches, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: refresh 强制重新请求并更新缓存", async () => {
  const home = withTempHome();
  const cache = memoryCache();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      fetcher,
      refreshExchange: true,
    });
    const forced = await buildPricingSnapshot([], {
      homeDirectory: home,
      cache,
      fetcher,
      refreshExchange: true,
    });
    assert.equal(forced.exchangeRateSource, "live");
    assert.equal(fetches, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
