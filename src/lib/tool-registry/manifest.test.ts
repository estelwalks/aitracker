/**
 * F6-T1/T2: public-manifest projection guarantees — the legacy marker is
 * stamped from `LEGACY_TOOL_IDS`, `skillAgentOrder` must come from the shared
 * pack and never be empty, and the checked-in generated manifest must carry
 * exactly the legacy set (drift guard).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ToolDefinition } from "./contracts.ts";
import type { SharedPolicyPacks } from "./schema.ts";
import {
  generatePublicManifest,
  LEGACY_TOOL_IDS,
  manifestIsSafe,
} from "./manifest.ts";
import { PUBLIC_TOOL_MANIFEST } from "./public-manifest.generated.ts";

function def(id: string): ToolDefinition {
  return {
    id,
    configVersion: 1,
    display: { name: id, nameZh: id },
    detection: { roots: [`.${id}`] },
    capabilities: {
      usage: { mode: "unsupported" },
      skills: { mode: "unsupported" },
      agents: { mode: "unsupported" },
      sessions: { mode: "unsupported" },
      market: { mode: "unsupported" },
      security: { mode: "unsupported" },
    },
  };
}

/** A pack whose `skillAgentOrder` is controllable (undefined = field absent). */
function packsWith(
  skillAgentOrder: readonly string[] | undefined,
): SharedPolicyPacks {
  return {
    skillMarketPolicy: {
      schemaVersion: 1,
      ...(skillAgentOrder !== undefined
        ? { skillAgentOrder: [...skillAgentOrder] }
        : {}),
      defaultMarkers: ["SKILL.md"],
      defaultMaxDepth: 3,
      marketInstallCondition: { requires: ["skills.mode=read-write"] },
    },
  } as unknown as SharedPolicyPacks;
}

describe("generatePublicManifest legacy projection (F6-T2)", () => {
  test("legacy sources (aipy/cline) are stamped legacy: true", () => {
    const manifest = generatePublicManifest([
      def("claude-code"),
      def("aipy"),
      def("cline"),
      def("cursor"),
    ]);
    const legacy = manifest.tools
      .filter((tool) => tool.legacy === true)
      .map((tool) => tool.id);
    assert.deepEqual([...legacy], ["aipy", "cline"]);
  });

  test("non-legacy tools carry no legacy field", () => {
    const manifest = generatePublicManifest([def("claude-code")]);
    assert.equal(manifest.tools[0].legacy, undefined);
  });

  test("the checked-in generated manifest carries exactly the legacy set", () => {
    const legacy = PUBLIC_TOOL_MANIFEST.tools
      .filter((tool) => tool.legacy === true)
      .map((tool) => tool.id);
    assert.deepEqual([...legacy], [...LEGACY_TOOL_IDS]);
    // Every legacy id must actually be present in the manifest tools.
    for (const id of LEGACY_TOOL_IDS) {
      assert.ok(
        PUBLIC_TOOL_MANIFEST.tools.some((tool) => tool.id === id),
        `legacy id "${id}" missing from the generated manifest`,
      );
    }
  });
});

describe("generatePublicManifest platform projection", () => {
  test("projects support facts but not platform path configuration", () => {
    const manifest = generatePublicManifest([
      {
        ...def("platform-tool"),
        platforms: {
          macos: "supported",
          windows: "planned",
          windows11: "unsupported",
          linux: "planned",
        },
      },
    ]);
    assert.deepEqual(manifest.tools[0].platforms, {
      macos: "supported",
      windows10: "planned",
      windows11: "unsupported",
      linux: "planned",
    });
    assert.equal(manifestIsSafe(manifest), true);
  });
});

describe("generatePublicManifest skillAgentOrder (F6-T1)", () => {
  test("the order is projected from the shared pack", () => {
    const manifest = generatePublicManifest(
      [def("claude-code"), def("codex")],
      packsWith(["claude-code", "codex"]),
    );
    assert.deepEqual([...manifest.skillAgentOrder!], ["claude-code", "codex"]);
  });

  test("an empty pack order fails the build", () => {
    assert.throws(
      () => generatePublicManifest([def("claude-code")], packsWith([])),
      /skillAgentOrder/,
    );
  });

  test("a pack without skillAgentOrder fails the build", () => {
    assert.throws(
      () => generatePublicManifest([def("claude-code")], packsWith(undefined)),
      /skillAgentOrder/,
    );
  });

  test("compiling without packs keeps the field absent (legacy path)", () => {
    const manifest = generatePublicManifest([def("claude-code")]);
    assert.equal(manifest.skillAgentOrder, undefined);
  });
});
