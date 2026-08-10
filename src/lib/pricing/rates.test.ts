import assert from "node:assert/strict";
import test from "node:test";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildPricingSnapshot } from "./dynamic.server.ts";
import { BUILTIN_RATES } from "./index.ts";

function withTempHome(): string {
  return mkdtempSync(join(tmpdir(), "tt-rates-test-"));
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

const LIVE_RATES = {
  date: "2026-08-05",
  rates: { CNY: 7.15, JPY: 146, KRW: 1360 },
};

test("汇率: 无缓存且网络失败 → 内置基准 fallback", async () => {
  const home = withTempHome();
  try {
    const snap = await buildPricingSnapshot([], {
      homeDirectory: home,
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

test("汇率: 网络成功 → live 并写缓存; 随后走 cache 不重复请求", async () => {
  const home = withTempHome();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const first = await buildPricingSnapshot([], {
      homeDirectory: home,
      fetcher,
    });
    assert.equal(first.exchangeRateSource, "live");
    assert.equal(first.exchangeRates.CNY, 7.15);
    assert.equal(first.exchangeRates.JPY, 146);
    assert.equal(first.exchangeRates.KRW, 1360);
    assert.equal(fetches, 1);

    // 缓存新鲜 → cache,不再请求
    const second = await buildPricingSnapshot([], {
      homeDirectory: home,
      fetcher,
    });
    assert.equal(second.exchangeRateSource, "cache");
    assert.equal(second.exchangeRates.CNY, 7.15);
    assert.equal(fetches, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 缓存过期后网络失败 → stale-cache 保留旧值", async () => {
  const home = withTempHome();
  try {
    const now = new Date("2026-08-05T10:00:00Z");
    const fresh = await buildPricingSnapshot([], {
      homeDirectory: home,
      now,
      fetcher: jsonFetcher(LIVE_RATES),
    });
    assert.equal(fresh.exchangeRateSource, "live");

    // 两小时后缓存过期;网络失败 → stale-cache
    const stale = await buildPricingSnapshot([], {
      homeDirectory: home,
      now: new Date("2026-08-05T12:00:00Z"),
      fetcher: failingFetcher(),
    });
    assert.equal(stale.exchangeRateSource, "stale-cache");
    assert.equal(stale.exchangeRates.CNY, 7.15);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 缓存新鲜时 refresh 强制重新请求", async () => {
  const home = withTempHome();
  try {
    let fetches = 0;
    const fetcher: typeof fetch = async () => {
      fetches += 1;
      return new Response(JSON.stringify(LIVE_RATES), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await buildPricingSnapshot([], { homeDirectory: home, fetcher });
    const forced = await buildPricingSnapshot([], {
      homeDirectory: home,
      fetcher,
      refreshExchange: true,
    });
    assert.equal(forced.exchangeRateSource, "live");
    assert.equal(fetches, 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
