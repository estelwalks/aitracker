/**
 * Double-read parity shadow (P3-T5): legacy TS definitions (tools/index.ts)
 * vs the v1.5 JSON definitions (definitions.generated.ts via the loader),
 * field by field. A diff fails the build - differences must be recorded in
 * expected-diff.md with owner + approval, never masked by editing this test.
 *
 * Deleted in P5-T1 once the legacy TS configs are removed.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { TOOL_DEFINITIONS } from "./tools/index.ts";
import { compileToolRegistry } from "./registry.ts";
import { loadBuiltinDefinitions } from "./loader.ts";

const legacy = compileToolRegistry(TOOL_DEFINITIONS);
const builtin = loadBuiltinDefinitions();
const jsonRegistry = compileToolRegistry(builtin.definitions, {
  sharedPacks: builtin.sharedPacks,
});

/** Projection-aware comparison for usage paths (targets is a new field). */
function usagePathsOf(def: {
  capabilities: { usage: { paths?: readonly unknown[] } };
}) {
  return (def.capabilities.usage.paths ?? []).map((p) => {
    const path = p as { root: string; glob: string; format: string };
    return { root: path.root, glob: path.glob, format: path.format };
  });
}

describe("double-read parity: legacy TS vs v1.5 JSON (TC-REG-001)", () => {
  test("same 29 definitions in the same order", () => {
    assert.equal(legacy.definitions.length, 29);
    assert.equal(jsonRegistry.definitions.length, 29);
    assert.deepEqual(
      jsonRegistry.definitions.map((d) => d.id),
      legacy.definitions.map((d) => d.id),
    );
  });

  test("27 visible + 2 legacy hidden, matching catalogVisible", () => {
    const visible = jsonRegistry.definitions.filter(
      (d) => d.catalogVisible !== false,
    );
    assert.equal(visible.length, 27);
    assert.deepEqual(
      visible.map((d) => d.id),
      legacy.definitions
        .filter((d) => d.catalogVisible !== false)
        .map((d) => d.id),
    );
  });

  test("per-tool fields are identical after projection", () => {
    const issues: string[] = [];
    const eq = (a: unknown, b: unknown) =>
      JSON.stringify(a) === JSON.stringify(b);
    for (const old of legacy.definitions) {
      const json = jsonRegistry.byId.get(old.id)!;
      if (!eq(old.display, json.display)) issues.push(`${old.id}: display`);
      if (!eq(old.detection.roots, json.detection.roots))
        issues.push(`${old.id}: detection.roots`);
      if (!eq(old.capabilities.usage.mode, json.capabilities.usage.mode))
        issues.push(`${old.id}: usage.mode`);
      if (!eq(old.capabilities.usage.reader, json.capabilities.usage.reader))
        issues.push(`${old.id}: usage.reader`);
      if (!eq(usagePathsOf(old), usagePathsOf(json)))
        issues.push(`${old.id}: usage.paths`);
      if (!eq(old.capabilities.usage.query, json.capabilities.usage.query))
        issues.push(`${old.id}: usage.query`);
      // The loader fills the generic default (8MB) when a supported usage
      // capability omits it; consumers used to apply the same default at read
      // time. Unsupported capabilities carry no size on either side.
      const oldMax = old.capabilities.usage.maxFileSizeBytes;
      const jsonMax = json.capabilities.usage.maxFileSizeBytes;
      if (json.capabilities.usage.mode !== "unsupported") {
        const defaultMax =
          builtin.sharedPacks.genericReaderDefaults.defaultMaxFileSizeBytes;
        if (oldMax !== undefined ? oldMax !== jsonMax : jsonMax !== defaultMax)
          issues.push(`${old.id}: usage.maxFileSizeBytes`);
      } else if (oldMax !== jsonMax) {
        issues.push(`${old.id}: usage.maxFileSizeBytes`);
      }
      if (!eq(old.capabilities.skills, json.capabilities.skills))
        issues.push(`${old.id}: skills`);
      if (!eq(old.capabilities.sessions, json.capabilities.sessions))
        issues.push(`${old.id}: sessions`);
      if (!eq(old.capabilities.market, json.capabilities.market))
        issues.push(`${old.id}: market`);
      if (!eq(old.capabilities.security, json.capabilities.security))
        issues.push(`${old.id}: security`);
      if (!eq(old.storage?.skills?.roots, json.storage?.skills?.roots))
        issues.push(`${old.id}: skills.roots`);
      if (!eq(old.storage?.skills?.envHome, json.storage?.skills?.envHome))
        issues.push(`${old.id}: skills.envHome`);
      if (!eq(old.storage?.skills?.markers, json.storage?.skills?.markers))
        issues.push(`${old.id}: skills.markers`);
      if (!eq(old.storage?.skills?.maxDepth, json.storage?.skills?.maxDepth))
        issues.push(`${old.id}: skills.maxDepth`);
    }
    assert.deepEqual(issues, []);
  });

  test("v1.5-only additions are present and coherent", () => {
    for (const def of jsonRegistry.definitions) {
      assert.ok(def.platforms, `${def.id}: platforms required`);
      assert.equal(def.platforms?.macos, "supported");
      assert.equal(def.platforms?.linux, "planned");
      assert.ok(def.detection.locations, `${def.id}: locations required`);
      const hasContext = def.capabilities.context !== undefined;
      if (def.id === "claude-code" || def.id === "codex") {
        assert.equal(hasContext, true, `${def.id}: context expected`);
        assert.equal(def.capabilities.context?.mode, "native");
      } else {
        assert.equal(hasContext, false, `${def.id}: context unexpected`);
      }
    }
  });

  test("pricing policy metadata matches the legacy billing derivation", () => {
    for (const old of legacy.definitions) {
      const json = jsonRegistry.byId.get(old.id)!;
      const billableOld =
        old.capabilities.usage.mode !== "unsupported" &&
        (old.capabilities.usage.paths?.length ?? 0) > 0;
      assert.equal(
        json.pricing?.billingMode,
        billableOld ? "api-metered" : "unsupported",
        `${old.id}: billingMode must match legacy derivation`,
      );
    }
  });

  test("no diagnostics on the JSON registry", () => {
    assert.deepEqual(
      jsonRegistry.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
  });
});
