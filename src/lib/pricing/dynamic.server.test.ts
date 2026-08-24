import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ExchangeRateCache } from "../../platform/snapshot-runtime/exchange-rate.server.ts";
import { buildPricingSnapshot } from "./dynamic.server.ts";

/** In-memory exchange-rate cache so the refresh never reaches the SQLite composition root. */
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

/**
 * Model prices are resolved offline from the rule-pack registry (resolve.ts);
 * this snapshot only carries exchange rates + the rule-pack version stamp. The
 * frankfurter mock uses the real v2 response shape: one `{ date, quote, rate }`
 * row per currency.
 */
test("refresh loads latest exchange rate and stamps the offline rule-pack version", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "tt-pricing-"));
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("frankfurter")) {
      return Response.json([
        { date: "2026-07-28", base: "USD", quote: "CNY", rate: 8 },
        { date: "2026-07-28", base: "USD", quote: "JPY", rate: 200 },
        { date: "2026-07-28", base: "USD", quote: "KRW", rate: 1600 },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  try {
    // 后台/手动刷新路径显式请求网络（T3-05：页面读取永不联网）。
    const snapshot = await buildPricingSnapshot([], {
      homeDirectory,
      now: new Date("2026-07-28T12:00:00.000Z"),
      fetcher,
      cache: memoryCache(),
      refreshExchange: true,
    });
    assert.equal(snapshot.exchangeRateSource, "live");
    assert.equal(snapshot.usdToCny, 8);
    assert.equal(snapshot.exchangeRates.JPY, 200);
    assert.equal(snapshot.exchangeRates.KRW, 1600);
    assert.equal(snapshot.exchangeRates.USD, 1);
    assert.equal(typeof snapshot.pricingRulesVersion, "string");
    assert.ok(snapshot.pricingRulesVersion.length > 0);
  } finally {
    await rm(homeDirectory, { recursive: true, force: true });
  }
});

test("Doubao tiered pricing is resolved offline from rule packs (parity at USD@7.2)", async () => {
  // Model pricing no longer flows through the snapshot; it is resolved per event
  // from the rule-pack registry. The Doubao tiered case is covered in
  // resolve.test.ts / parity.test.ts (200k input -> open tier -> 6.93 USD).
  const { estimateEventCost } = await import("./index.ts");
  const { applyPricingSnapshot } = await import("./index.ts");
  try {
    applyPricingSnapshot(null);
    const cost = estimateEventCost({
      source: "codex",
      timestamp: "2026-07-28T10:00:00.000Z",
      model: "doubao-seed-2-0-code",
      project: "test",
      inputTokens: 200_000,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
      totalTokens: 1_200_000,
    });
    // tier3 (open): 0.2MTok*(9.6/7.2) + 1MTok*(48/7.2) = 6.9333... USD.
    // No billing evidence on local events -> reference-route estimated subtotal.
    assert.ok(Math.abs(cost.estimatedUsd - 6.933333333) < 1e-6);
    assert.equal(cost.knownUsd, 0);
    assert.equal(cost.complete, true);
  } finally {
    applyPricingSnapshot(null);
  }
});
