import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createExchangeRateRepository } from "./exchange-rate.server.ts";

const LIVE_RATES = {
  date: "2026-08-05",
  rates: { CNY: 7.15, JPY: 146, KRW: 1360 },
};

function withTempHome(): string {
  return mkdtempSync(join(tmpdir(), "trusttools-rates-"));
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
  const home = withTempHome();
  try {
    let fetches = 0;
    const repo = createExchangeRateRepository({
      fetcher: async () => {
        fetches += 1;
        return new Response(JSON.stringify(LIVE_RATES), { status: 200 });
      },
      now: () => new Date("2026-08-05T10:00:00Z"),
    });
    await repo.refresh({ homeDirectory: home });
    const next = await repo.readCache({ homeDirectory: home });
    assert.equal(next.source, "cache");
    assert.equal(next.stale, false);
    assert.equal(fetches, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 23:59 缓存仍新鲜,不尝试网络", async () => {
  const home = withTempHome();
  try {
    const repo = createExchangeRateRepository({
      fetcher: jsonFetcher(LIVE_RATES),
      now: () => new Date("2026-08-05T10:00:00Z"),
    });
    await repo.refresh({ homeDirectory: home });
    const late = createExchangeRateRepository({
      fetcher: failingFetcher(),
      now: () => new Date("2026-08-05T23:59:00Z"),
    });
    // readCache never fetches; even a failing fetcher is never called.
    const snapshot = await late.readCache({ homeDirectory: home });
    assert.equal(snapshot.source, "cache");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 超过 24 小时后 stale,先返回 stale-cache 再后台刷新", async () => {
  const home = withTempHome();
  try {
    const fresh = createExchangeRateRepository({
      fetcher: jsonFetcher(LIVE_RATES),
      now: () => new Date("2026-08-05T10:00:00Z"),
    });
    await fresh.refresh({ homeDirectory: home });

    const nextDay = createExchangeRateRepository({
      fetcher: jsonFetcher(LIVE_RATES),
      now: () => new Date("2026-08-06T10:30:00Z"),
    });
    const stale = await nextDay.readCache({ homeDirectory: home });
    assert.equal(stale.source, "stale-cache");
    assert.equal(stale.stale, true);
    assert.equal(stale.rates.CNY, 7.15);

    const refreshed = await nextDay.refresh({ homeDirectory: home });
    assert.equal(refreshed.source, "live");
    assert.equal(refreshed.stale, false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 离线失败保留 last-known-good(stale-cache)", async () => {
  const home = withTempHome();
  try {
    const fresh = createExchangeRateRepository({
      fetcher: jsonFetcher(LIVE_RATES),
      now: () => new Date("2026-08-05T10:00:00Z"),
    });
    await fresh.refresh({ homeDirectory: home });

    const offline = createExchangeRateRepository({
      fetcher: failingFetcher(),
      now: () => new Date("2026-08-07T10:00:00Z"),
    });
    const result = await offline.refresh({ homeDirectory: home });
    assert.equal(result.source, "stale-cache");
    assert.equal(result.rates.CNY, 7.15);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("汇率: 无缓存且离线 → 内建 fallback", async () => {
  const home = withTempHome();
  try {
    const repo = createExchangeRateRepository({
      fetcher: failingFetcher(),
      now: () => new Date("2026-08-05T10:00:00Z"),
    });
    const result = await repo.readCache({ homeDirectory: home });
    assert.equal(result.source, "fallback");
    assert.ok(result.rates.CNY > 0);
    assert.equal(result.rates.USD, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
