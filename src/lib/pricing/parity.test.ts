import assert from "node:assert/strict";
import test from "node:test";

import type { PricingLookupInput } from "./contracts.ts";
import { compilePricingRegistry } from "./compile.ts";
import { resolvePrice } from "./resolve.ts";
import {
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
} from "./pricing-definitions.generated.ts";
import { BASELINE_MODEL_PRICES } from "../tool-registry/__baseline__/baseline.ts";

const registry = compilePricingRegistry(
  PRICING_PACKS,
  PRICING_REGISTRY_VERSION,
);

function inputOnly(model: string, input = 1_000_000n): PricingLookupInput {
  return {
    toolId: "codex",
    rawModel: model,
    occurredAt: "2026-07-28T00:00:00.000Z",
    tokens: {
      input,
      output: 0n,
      cacheRead: 0n,
      cacheWrite: 0n,
      reasoningOutput: 0n,
    },
  };
}

/**
 * Approved parity difference (audit P1-1, F1-T9): local usage events carry no
 * billing evidence, so the 12 frozen baseline prices now reproduce with
 * `estimated` confidence (reference-route price, reason `no-route-evidence`)
 * instead of `exact`. The amounts are unchanged and fully recalculable; the
 * confidence downgrade is exactly what the audit requires ("There shall be no default when there is insufficient evidence.
 * Use "model official price").
 */
test("baseline MODEL_PRICES: all 12 reproduce their input amounts (estimated, no evidence)", () => {
  for (const bp of BASELINE_MODEL_PRICES) {
    const model =
      bp.matcher.kind === "exactOrSnapshot"
        ? bp.matcher.names[0]
        : bp.matcher.parts.join("-");
    const res = resolvePrice(registry, inputOnly(model), {});
    const expected = BigInt(Math.round(bp.inputUsdPerMillion * 1_000_000_000));
    assert.equal(
      res.confidence,
      "estimated",
      `${model}: expected estimated, got ${res.confidence}`,
    );
    assert.equal(res.reason, "no-route-evidence", model);
    assert.equal(res.knownUsdNano, expected, `${model}: expected ${expected}`);
  }
});

test("baseline MODEL_PRICES: output amounts reproduce (estimated, no evidence)", () => {
  for (const bp of BASELINE_MODEL_PRICES) {
    const model =
      bp.matcher.kind === "exactOrSnapshot"
        ? bp.matcher.names[0]
        : bp.matcher.parts.join("-");
    const res = resolvePrice(
      registry,
      {
        ...inputOnly(model),
        tokens: {
          input: 0n,
          output: 1_000_000n,
          cacheRead: 0n,
          cacheWrite: 0n,
          reasoningOutput: 0n,
        },
      },
      {},
    );
    const expected = BigInt(Math.round(bp.outputUsdPerMillion * 1_000_000_000));
    assert.equal(
      res.knownUsdNano,
      expected,
      `${model} output: expected ${expected}`,
    );
  }
});

test("with route evidence the same baselines resolve exact (route-first)", () => {
  const evidenceByModel: Record<string, string> = {
    "gpt-5.6-sol": "https://api.openai.com/v1",
    "gpt-5.6-terra": "https://api.openai.com/v1",
    "gpt-5.6-luna": "https://api.openai.com/v1",
    "gpt-5.5": "https://api.openai.com/v1",
    "gpt-5.4": "https://api.openai.com/v1",
    "gpt-5.2": "https://api.openai.com/v1",
    "gpt-5.1-codex": "https://api.openai.com/v1",
    "gpt-5-codex": "https://api.openai.com/v1",
    "claude-opus-4": "https://api.anthropic.com/v1",
    "claude-sonnet-4": "https://api.anthropic.com/v1",
    "claude-3-7-sonnet": "https://api.anthropic.com/v1",
    "claude-3-5-haiku": "https://api.anthropic.com/v1",
    "deepseek-v4-pro": "https://api.deepseek.com/v1",
    "minimax-m2-5": "https://api.minimax.chat/v1",
    "minimax-m2-7-highspeed": "https://api.minimax.chat/v1",
    "glm-5": "https://api.zhipu.ai/v1",
    "doubao-seed-2-0-code": "https://ark.volcengine.com/v1",
  };
  for (const bp of BASELINE_MODEL_PRICES) {
    const model =
      bp.matcher.kind === "exactOrSnapshot"
        ? bp.matcher.names[0]
        : bp.matcher.parts.join("-");
    const res = resolvePrice(
      registry,
      {
        ...inputOnly(model),
        evidence: { endpoint: evidenceByModel[model] ?? "" },
      },
      {},
    );
    assert.equal(
      res.confidence,
      "exact",
      `${model}: expected exact with evidence, got ${res.confidence}`,
    );
  }
});

test("OFFICIAL_PRICES parity: deepseek/minimax/glm-5 reproduce", () => {
  const cases: Array<[string, number]> = [
    ["deepseek-v4-pro", 0.435],
    ["minimax-m2-5", 0.3],
    ["minimax-m2-7-highspeed", 0.6],
    ["glm-5", 1],
  ];
  for (const [model, usdPerMillion] of cases) {
    const res = resolvePrice(registry, inputOnly(model), {});
    const expected = BigInt(Math.round(usdPerMillion * 1_000_000_000));
    assert.equal(res.confidence, "estimated", `${model}: expected estimated`);
    assert.equal(res.knownUsdNano, expected, `${model}: expected ${expected}`);
  }
});

test("deepseek free cache-write (rate 0) is billed as zero, not unknown", () => {
  // deepseek-v4-pro has cacheWrite "0" (free), so cache-write tokens are billable at 0.
  const res = resolvePrice(
    registry,
    {
      ...inputOnly("deepseek-v4-pro"),
      tokens: {
        input: 0n,
        output: 0n,
        cacheRead: 0n,
        cacheWrite: 1_000_000n,
        reasoningOutput: 0n,
      },
    },
    {},
  );
  assert.equal(res.confidence, "estimated");
  assert.equal(res.knownUsdNano, 0n);
});

test("approved diff: glm-5.2 (was LiteLLM dynamic 1.4) is now generic-estimated offline", () => {
  // Removing the LiteLLM authoritative path means dynamically-priced models
  // that were never curated into a pack fall back to the packaged generic
  // estimate (api-generic-v1, confidence "estimated") instead of being
  // unpriced - the estimate is the packaged-JSON default (no env gate).
  const res = resolvePrice(registry, inputOnly("glm-5.2"), {});
  assert.equal(res.confidence, "estimated");
  assert.equal(res.fallbackProfileId, "api-generic-v1");
  assert.equal(res.knownUsdNano, 1_000_000_000n); // generic input $1/MTok
});
