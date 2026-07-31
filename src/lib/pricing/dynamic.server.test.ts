import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { LocalUsageEvent } from "../local-usage";
import { buildPricingSnapshot } from "./dynamic.server.ts";
import { applyPricingSnapshot, estimateEventCost } from "./index.ts";

function event(model: string, inputTokens: number): LocalUsageEvent {
  return {
    source: "codex",
    timestamp: "2026-07-28T10:00:00.000Z",
    model,
    project: "test",
    inputTokens,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 1_000_000,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + 1_000_000,
  };
}

test("loads dynamic prices, official overrides, tiered Doubao pricing, and latest exchange rate", async () => {
  const homeDirectory = await mkdtemp(join(tmpdir(), "trusttools-pricing-"));
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("frankfurter")) {
      return Response.json({ date: "2026-07-28", base: "USD", quote: "CNY", rate: 8 });
    }
    return Response.json({
      "glm-5.2": {
        input_cost_per_token: 0.0000014,
        output_cost_per_token: 0.0000044,
        cache_read_input_token_cost: 2.6e-7,
      },
    });
  };

  try {
    const snapshot = await buildPricingSnapshot(
      ["glm-5.2", "MiniMax-M2.7-highspeed", "doubao-seed-2-0-code"],
      {
        homeDirectory,
        now: new Date("2026-07-28T12:00:00.000Z"),
        fetcher,
      },
    );
    assert.equal(snapshot.priceSource, "live");
    assert.equal(snapshot.exchangeRateSource, "live");
    assert.equal(snapshot.usdToCny, 8);
    assert.equal(snapshot.prices["glm-5-2"]?.inputUsdPerMillion, 1.4);
    assert.equal(snapshot.prices["minimax-m2-7-highspeed"]?.outputUsdPerMillion, 2.4);
    assert.equal(snapshot.prices["doubao-seed-2-0-code"]?.tiers?.length, 3);

    applyPricingSnapshot(snapshot);
    const doubao = estimateEventCost(event("doubao-seed-2-0-code", 200_000));
    assert.equal(doubao.knownUsd * snapshot.usdToCny, 49.92);
  } finally {
    applyPricingSnapshot(null);
    await rm(homeDirectory, { recursive: true, force: true });
  }
});
