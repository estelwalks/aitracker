import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_TOOL_MANIFEST } from "../../lib/tool-registry/public-manifest.generated.ts";
import { findDtoDisclosureViolations } from "../../test-support/privacy-contract.ts";
import { projectAgentDefinitions } from "./registry-projection.ts";

test("Agent Directory projects every public registry tool into a renderable card", () => {
  const definitions = projectAgentDefinitions(PUBLIC_TOOL_MANIFEST);

  assert.equal(definitions.length, PUBLIC_TOOL_MANIFEST.tools.length);
  assert.deepEqual(
    definitions.map((definition) => definition.id),
    PUBLIC_TOOL_MANIFEST.tools.map((tool) => tool.id),
  );
  for (const definition of definitions) {
    assert.ok(definition.name.length > 0);
    assert.ok(definition.nameZh.length > 0);
    assert.ok(definition.capabilities);
    assert.ok(definition.platforms);
  }
});

test("Agent Directory registry facts do not disclose private tool configuration", () => {
  const definitions = projectAgentDefinitions(PUBLIC_TOOL_MANIFEST);
  assert.deepEqual(findDtoDisclosureViolations(definitions), []);

  for (const definition of definitions) {
    for (const key of Object.keys(definition)) {
      assert.ok(
        [
          "capabilities",
          "icon",
          "id",
          "legacy",
          "name",
          "nameZh",
          "platforms",
          "pricingObservationRef",
        ].includes(key),
        `unexpected public AgentDefinition field: ${key}`,
      );
    }
  }

  const serialized = JSON.stringify(definitions);
  for (const forbidden of [
    "CODEX_HOME",
    ".codex/skills",
    ".claude/projects",
    "rollout",
    "session-v1",
    "{sessionId}",
    "UsdPerMillion",
    "modelObservation",
    "pricing",
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `Agent Directory fact leaks ${forbidden}`,
    );
  }
});

test("Agent Directory facts retain only public support status across platforms", () => {
  const definitions = projectAgentDefinitions(PUBLIC_TOOL_MANIFEST);
  const codex = definitions.find((definition) => definition.id === "codex");
  assert.deepEqual(codex?.platforms, {
    macos: "supported",
    windows10: "supported",
    windows11: "supported",
    linux: "planned",
  });
  assert.equal("pricingObservationRef" in (codex ?? {}), false);
});
