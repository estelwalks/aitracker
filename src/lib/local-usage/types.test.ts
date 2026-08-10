/**
 * F6-T2: the usage source universe is projected from the public manifest —
 * every catalog tool id, plus legacy-marked ids, deduped. No hardcoded source
 * list may live in this module.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";
import { KNOWN_LOCAL_USAGE_SOURCES } from "./types.ts";

describe("KNOWN_LOCAL_USAGE_SOURCES projection (F6-T2)", () => {
  test("matches the manifest tool ids exactly, in order, with no duplicates", () => {
    const manifestIds = PUBLIC_TOOL_MANIFEST.tools.map((tool) => tool.id);
    assert.deepEqual([...KNOWN_LOCAL_USAGE_SOURCES], manifestIds);
    assert.equal(new Set(KNOWN_LOCAL_USAGE_SOURCES).size, manifestIds.length);
  });

  test("legacy-marked sources are included (aipy/cline present once)", () => {
    const legacyIds = PUBLIC_TOOL_MANIFEST.tools
      .filter((tool) => tool.legacy === true)
      .map((tool) => tool.id);
    assert.ok(legacyIds.length > 0, "expected legacy-marked tools");
    for (const id of legacyIds) {
      const occurrences = KNOWN_LOCAL_USAGE_SOURCES.filter(
        (source) => source === id,
      );
      assert.equal(occurrences.length, 1, `"${id}" must appear exactly once`);
    }
  });
});
