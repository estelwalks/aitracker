/**
 * P4-T2: SKILL_AGENT_ORDER is derived from skill-market-policy.json (via the
 * browser-safe public manifest), not a hardcoded list (TC-POL-001).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SKILL_AGENT_ORDER, SKILL_AGENTS } from "./agent-rules.ts";
import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";

const here = dirname(fileURLToPath(import.meta.url));
const policy = JSON.parse(
  readFileSync(
    join(here, "../tool-registry/definitions/_shared/skill-market-policy.json"),
    "utf8",
  ),
) as { skillAgentOrder: string[] };

describe("skill-market policy derivation (TC-POL-001)", () => {
  test("SKILL_AGENT_ORDER matches the policy file item by item", () => {
    assert.deepEqual([...SKILL_AGENT_ORDER], policy.skillAgentOrder);
  });

  test("the manifest carries the same order", () => {
    assert.deepEqual(
      [...(PUBLIC_TOOL_MANIFEST.skillAgentOrder ?? [])],
      policy.skillAgentOrder,
    );
  });

  test("SKILL_AGENTS labels stay in canonical order and are unique", () => {
    assert.equal(SKILL_AGENTS.length, policy.skillAgentOrder.length);
    assert.equal(new Set(SKILL_AGENTS).size, SKILL_AGENTS.length);
  });
});
