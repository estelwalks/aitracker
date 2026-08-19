import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canEnhanceNow,
  composeLineText,
  ENHANCE_COOLDOWN_MS,
  insightActionPath,
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
    assert.equal(
      composeLineText(t, { key: "k", params: { n: 3 } }),
      "k(n=3)",
    );
  });

  it("appends the analysis sentence after a full stop", () => {
    assert.equal(
      composeLineText(t, { key: "k", analysis: "模型补充说明" }),
      "k。模型补充说明",
    );
  });
});

describe("canEnhanceNow", () => {
  it("allows the first enhance (no previous attempt)", () => {
    assert.equal(canEnhanceNow(null, 1000), true);
    assert.equal(canEnhanceNow(undefined, 1000), true);
  });

  it("allows after the cooldown elapses", () => {
    assert.equal(
      canEnhanceNow(0, ENHANCE_COOLDOWN_MS),
      true,
    );
    assert.equal(
      canEnhanceNow(0, ENHANCE_COOLDOWN_MS + 1),
      true,
    );
  });

  it("blocks within the cooldown window", () => {
    assert.equal(canEnhanceNow(0, ENHANCE_COOLDOWN_MS - 1), false);
    assert.equal(canEnhanceNow(10_000, 10_000 + 59_999), false);
  });
});
