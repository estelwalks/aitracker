import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  insightActionPath,
  insightFallbackStatusLabel,
  insightStatusLabel,
  type InsightActionId,
  type InsightEnvelopeStatus,
} from "./use-page-insight.pure";

describe("insightStatusLabel", () => {
  it("maps every envelope status to a settings.insight.status.* key", () => {
    const statuses: InsightEnvelopeStatus[] = [
      "rules",
      "enhanced-cached",
      "enhanced-ready",
      "enhancer-unavailable",
      "budget-exceeded",
      "timeout",
      "enhancer-failed",
      "invalid-output",
      "stale",
    ];
    for (const status of statuses) {
      assert.match(insightStatusLabel(status), /^settings\.insight\.status\./);
    }
  });
});

describe("insightFallbackStatusLabel", () => {
  it("explains model failures while leaving normal rule envelopes unmarked", () => {
    assert.equal(
      insightFallbackStatusLabel("enhancer-unavailable"),
      "settings.insight.fallbackStatus.enhancer-unavailable",
    );
    assert.equal(
      insightFallbackStatusLabel("budget-exceeded"),
      "settings.insight.fallbackStatus.budget-exceeded",
    );
    assert.equal(
      insightFallbackStatusLabel("timeout"),
      "settings.insight.fallbackStatus.timeout",
    );
    assert.equal(
      insightFallbackStatusLabel("enhancer-failed"),
      "settings.insight.fallbackStatus.enhancer-failed",
    );
    assert.equal(
      insightFallbackStatusLabel("invalid-output"),
      "settings.insight.fallbackStatus.invalid-output",
    );
    assert.equal(insightFallbackStatusLabel("rules"), null);
    assert.equal(insightFallbackStatusLabel("enhanced-ready"), null);
  });
});

describe("insightActionPath", () => {
  it("returns the frozen in-app route for each action id", () => {
    const expected: Record<InsightActionId, string> = {
      open_security: "/security",
      open_distill: "/distill",
      open_reports: "/reports",
      open_sessions: "/chats",
      open_sources: "/sources",
      open_settings: "/settings",
      open_tracker: "/tracker",
      open_market: "/market",
      open_skills: "/skills",
      open_memory: "/memory",
    };
    for (const [id, path] of Object.entries(expected) as [
      InsightActionId,
      string,
    ][]) {
      assert.equal(insightActionPath(id), path);
    }
  });
});

describe("composeLineText", () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params
      ? `${key}(${Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(",")})`
      : key;

  it("returns the base message when there is no analysis", () => {
    assert.equal(composeLineText(t, { key: "k", params: { n: 3 } }), "k(n=3)");
  });

  it("appends the analysis sentence after a full stop", () => {
    assert.equal(
      composeLineText(t, { key: "k", analysis: "模型补充说明" }),
      "k。模型补充说明",
    );
  });

  it("does not duplicate an existing Chinese sentence mark", () => {
    assert.equal(
      composeLineText(() => "本地规则。", {
        key: "k",
        analysis: "模型补充说明",
      }),
      "本地规则。模型补充说明",
    );
  });

  it("adds one space after an existing English sentence mark", () => {
    assert.equal(
      composeLineText(() => "Rule insight.", {
        key: "k",
        analysis: "Model analysis.",
      }),
      "Rule insight. Model analysis.",
    );
  });

  it("adds a Chinese full stop when the base has no sentence mark", () => {
    assert.equal(
      composeLineText(() => "本地规则", {
        key: "k",
        analysis: "模型补充说明",
      }),
      "本地规则。模型补充说明",
    );
  });

  it("does not append a near-paraphrase of the security fact", () => {
    const fact = "今日安全扫描未发现风险，所有项目均通过检查。";
    assert.equal(
      composeLineText(() => fact, {
        key: "k",
        analysis: "今日未发现安全风险，所有已扫描项目均通过检查。",
      }),
      fact,
    );
  });

  it("does not append a near-paraphrase of the cache fact", () => {
    const fact = "「aipy」缓存命中率仅 0，建议复用上下文以降低成本。";
    assert.equal(
      composeLineText(() => fact, {
        key: "k",
        analysis: "缓存命中率极低，建议复用上下文以降低成本。",
      }),
      fact,
    );
  });
});

describe("canEnhanceNow", () => {
  it("allows the first enhance (no previous attempt)", () => {
    assert.equal(canEnhanceNow(null, 1000), true);
    assert.equal(canEnhanceNow(undefined, 1000), true);
  });

  it("allows after the cooldown elapses", () => {
    assert.equal(canEnhanceNow(0, ENHANCE_COOLDOWN_MS), true);
    assert.equal(canEnhanceNow(0, ENHANCE_COOLDOWN_MS + 1), true);
  });

  it("blocks within the cooldown window", () => {
    assert.equal(canEnhanceNow(0, ENHANCE_COOLDOWN_MS - 1), false);
    assert.equal(canEnhanceNow(10_000, 10_000 + 59_999), false);
  });
});
