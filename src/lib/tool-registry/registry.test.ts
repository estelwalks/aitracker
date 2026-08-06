import assert from "node:assert/strict";
import test from "node:test";

import type { ToolDefinition } from "./contracts.ts";
import { matchModel, normalizeModel } from "./contracts.ts";
import {
  compileToolRegistry,
  findModelRateIn,
  getSessionPlanFor,
  getUsagePlanFor,
} from "./registry.ts";
import { generatePublicManifest, manifestIsSafe } from "./manifest.ts";
import { computeRegistryFingerprint } from "./fingerprint.server.ts";

function codexLike(): ToolDefinition {
  return {
    id: "codex",
    configVersion: 1,
    display: { name: "Codex CLI", nameZh: "Codex CLI" },
    detection: { roots: [".codex"] },
    storage: {
      skills: {
        roots: [".codex/skills"],
        envHome: "CODEX_HOME",
        markers: ["SKILL.md"],
        maxDepth: 3,
      },
    },
    capabilities: {
      usage: {
        mode: "native",
        reader: "codex-rollout-v1",
        paths: [
          {
            root: ".codex/sessions",
            glob: "**/rollout-*.jsonl",
            format: "jsonl",
          },
          {
            root: ".codex/archived_sessions",
            glob: "**/rollout-*.jsonl",
            format: "jsonl",
          },
        ],
      },
      skills: { mode: "read-write" },
      agents: { mode: "unsupported" },
      sessions: {
        mode: "resume",
        reader: "codex-session-v1",
        command: ["codex", "resume", "{sessionId}"],
      },
      market: { mode: "install-target" },
      security: { mode: "scan" },
    },
    pricing: {
      provider: "openai",
      rules: [
        {
          id: "gpt-5-codex",
          label: "GPT-5 Codex",
          effectiveFrom: "2026-07-27",
          inputUsdPerMillion: 1.25,
          outputUsdPerMillion: 10,
          cacheReadUsdPerMillion: 0.125,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5-codex"] },
        },
      ],
    },
  };
}

test("compileToolRegistry builds id index and manifest", () => {
  const reg = compileToolRegistry([codexLike()]);
  assert.deepEqual([...reg.ids], ["codex"]);
  assert.ok(reg.byId.has("codex"));
  assert.equal(reg.diagnostics.length, 0);
  assert.equal(reg.publicManifest.tools.length, 1);
  assert.equal(reg.publicManifest.tools[0].id, "codex");
});

test("getUsagePlanFor returns reader/paths; null when unsupported", () => {
  const plan = getUsagePlanFor(codexLike());
  assert.equal(plan?.reader, "codex-rollout-v1");
  assert.equal(plan?.paths.length, 2);
  const unsupported: ToolDefinition = {
    ...codexLike(),
    capabilities: {
      ...codexLike().capabilities,
      usage: { mode: "unsupported" },
    },
  };
  assert.equal(getUsagePlanFor(unsupported), null);
});

test("getSessionPlanFor returns reader/command; null when unsupported", () => {
  const plan = getSessionPlanFor(codexLike());
  assert.equal(plan?.reader, "codex-session-v1");
  assert.deepEqual([...plan!.command], ["codex", "resume", "{sessionId}"]);
  const unsupported: ToolDefinition = {
    ...codexLike(),
    capabilities: {
      ...codexLike().capabilities,
      sessions: { mode: "unsupported" },
    },
  };
  assert.equal(getSessionPlanFor(unsupported), null);
});

test("findModelRateIn matches exact, dated snapshot, and returns null for unknown", () => {
  const reg = compileToolRegistry([codexLike()]);
  const exact = findModelRateIn(reg, {
    toolId: "codex",
    model: "gpt-5-codex",
    occurredAt: "2026-08-01",
  });
  assert.equal(exact?.id, "gpt-5-codex");
  const snapshot = findModelRateIn(reg, {
    toolId: "codex",
    model: "gpt-5-codex-2026-07-27",
    occurredAt: "2026-08-01",
  });
  assert.equal(snapshot?.id, "gpt-5-codex");
  const unknown = findModelRateIn(reg, {
    toolId: "codex",
    model: "gpt-4",
    occurredAt: "2026-08-01",
  });
  assert.equal(unknown, null);
  // Before effective date -> null.
  const early = findModelRateIn(reg, {
    toolId: "codex",
    model: "gpt-5-codex",
    occurredAt: "2025-01-01",
  });
  assert.equal(early, null);
  // Unknown tool -> null.
  assert.equal(
    findModelRateIn(reg, { toolId: "nope", model: "gpt-5-codex" }),
    null,
  );
});

test("findModelRateIn prefers higher priority then later effectiveFrom", () => {
  const def: ToolDefinition = {
    ...codexLike(),
    pricing: {
      provider: "openai",
      rules: [
        {
          id: "low",
          label: "L",
          priority: 0,
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 1,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
        {
          id: "high",
          label: "H",
          priority: 5,
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 9,
          outputUsdPerMillion: 9,
          cacheReadUsdPerMillion: 0.9,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
      ],
    },
  };
  const reg = compileToolRegistry([def]);
  const rate = findModelRateIn(reg, {
    toolId: "codex",
    model: "gpt-5",
    occurredAt: "2026-06-01",
  });
  assert.equal(rate?.id, "high");
});

test("public manifest contains no sensitive fields (TC-REG-003)", () => {
  const manifest = generatePublicManifest([codexLike()]);
  assert.equal(manifestIsSafe(manifest), true);
  const serialized = JSON.stringify(manifest);
  // Spot-check the most dangerous tokens.
  for (const token of [
    "CODEX_HOME",
    "{sessionId}",
    "codex-rollout-v1",
    "codex-session-v1",
    ".codex/sessions",
    "UsdPerMillion",
    "rollout",
  ]) {
    assert.ok(!serialized.includes(token), `manifest leaks "${token}"`);
  }
  // Capability modes ARE present.
  assert.equal(manifest.tools[0].capabilities.usage, "native");
  assert.equal(manifest.tools[0].capabilities.sessions, "resume");
});

test("canonicalSource and fingerprint are deterministic and change with paths", () => {
  const reg1 = compileToolRegistry([codexLike()]);
  const reg2 = compileToolRegistry([codexLike()]);
  assert.equal(reg1.canonicalSource, reg2.canonicalSource);
  assert.equal(
    computeRegistryFingerprint(reg1),
    computeRegistryFingerprint(reg2),
  );

  const altered: ToolDefinition = {
    ...codexLike(),
    capabilities: {
      ...codexLike().capabilities,
      usage: {
        mode: "native",
        reader: "codex-rollout-v1",
        paths: [
          { root: ".codex/other", glob: "**/rollout-*.jsonl", format: "jsonl" },
        ],
      },
    },
  };
  const reg3 = compileToolRegistry([altered]);
  assert.notEqual(reg1.canonicalSource, reg3.canonicalSource);
  assert.notEqual(
    computeRegistryFingerprint(reg1),
    computeRegistryFingerprint(reg3),
  );
});

test("matchModel reproduces exactOrSnapshot and includesAll semantics", () => {
  assert.equal(
    matchModel(
      { kind: "exactOrSnapshot", names: ["gpt-5.6-sol"] },
      normalizeModel("gpt-5.6-sol"),
    ),
    true,
  );
  assert.equal(
    matchModel(
      { kind: "exactOrSnapshot", names: ["gpt-5.6-sol"] },
      normalizeModel("gpt-5.6-sol-2026-07-27"),
    ),
    true,
  );
  assert.equal(
    matchModel(
      { kind: "exactOrSnapshot", names: ["gpt-5.6-sol"] },
      normalizeModel("gpt-5.6-terra"),
    ),
    false,
  );
  assert.equal(
    matchModel(
      { kind: "includesAll", parts: ["claude", "opus", "4"] },
      normalizeModel("claude-opus-4-20250514"),
    ),
    true,
  );
  assert.equal(
    matchModel(
      { kind: "includesAll", parts: ["claude", "opus", "4"] },
      normalizeModel("claude-sonnet-4"),
    ),
    false,
  );
});

// ---------------------------------------------------------------------------
// v1.5 platform-aware API (P3-T4): TC-PLAT-001/002, skill plan, context plan,
// session tools, canonical-source full coverage, manifest token additions.
// ---------------------------------------------------------------------------
import { describe, test as it } from "node:test";
import {
  getContextPlan,
  getSkillPlan,
  listSessionTools,
  osTargets,
  resolvePlatformPlan,
} from "./registry.ts";
import { computeToolRegistryVersion } from "./fingerprint.server.ts";

function v15Tool(): ToolDefinition {
  return {
    id: "v15-tool",
    configVersion: 1,
    display: { name: "V15 Tool", nameZh: "V15 工具" },
    platforms: { macos: "supported", windows: "supported", linux: "planned" },
    detection: {
      roots: [".v15", "Library/Application Support/V15", "AppData/Roaming/V15"],
      locations: [
        { targets: ["macos"], base: "appData", path: "V15" },
        {
          targets: ["windows10", "windows11"],
          base: "appDataRoaming",
          path: "V15",
        },
        {
          targets: ["macos", "windows10", "windows11", "linux"],
          base: "home",
          path: ".v15",
        },
      ],
    },
    storage: {
      skills: {
        roots: [".v15/skills"],
        rootSpecs: [{ base: "home", path: ".v15/skills" }],
        markers: ["SKILL.md"],
        maxDepth: 3,
      },
    },
    capabilities: {
      usage: { mode: "unsupported" },
      skills: { mode: "read-write" },
      agents: { mode: "unsupported" },
      sessions: {
        mode: "resume",
        reader: "codex-session-v1",
        command: ["codex", "resume", "{sessionId}"],
      },
      market: { mode: "install-target" },
      security: { mode: "scan" },
      context: {
        mode: "native",
        reader: "codex-context-v1",
        dimensions: ["tools"],
      },
    },
  };
}

function regWith(def: ToolDefinition) {
  return compileToolRegistry([def]);
}

describe("resolvePlatformPlan (TC-PLAT-001)", () => {
  it("expands windows os into the windows10/11 group", () => {
    assert.deepEqual(osTargets("windows"), ["windows10", "windows11"]);
  });

  it("resolves per-platform detection paths", () => {
    const reg = regWith(v15Tool());
    const macos = resolvePlatformPlan("v15-tool", "detection", "macos", reg);
    assert.equal(macos?.status, "supported");
    // Order follows the locations declaration order.
    assert.deepEqual(macos?.paths, ["Library/Application Support/V15", ".v15"]);

    const win = resolvePlatformPlan("v15-tool", "detection", "windows", reg);
    assert.deepEqual(win?.paths, ["AppData/Roaming/V15", ".v15"]);
  });

  it("filters usage paths by their targets", () => {
    const def = v15Tool();
    def.capabilities.usage = {
      mode: "native",
      reader: "generic-jsonl",
      paths: [
        {
          root: ".v15/projects",
          glob: "**/*.jsonl",
          format: "jsonl",
          targets: ["macos", "linux"],
        },
        {
          root: "AppData/Roaming/V15/projects",
          glob: "**/*.jsonl",
          format: "jsonl",
          targets: ["windows10", "windows11"],
        },
      ],
    };
    const reg = regWith(def);
    const macos = resolvePlatformPlan("v15-tool", "usage", "macos", reg);
    assert.deepEqual(macos?.paths, [".v15/projects"]);
    const win = resolvePlatformPlan("v15-tool", "usage", "windows", reg);
    assert.deepEqual(win?.paths, ["AppData/Roaming/V15/projects"]);
  });
});

describe("Linux planned never produces scan paths (TC-PLAT-002)", () => {
  it("returns planned status with empty paths", () => {
    const reg = regWith(v15Tool());
    const linux = resolvePlatformPlan("v15-tool", "detection", "linux", reg);
    assert.equal(linux?.status, "planned");
    assert.deepEqual(linux?.paths, []);
  });

  it("a tool without platforms falls back to supported (legacy configs)", () => {
    const def = codexLike();
    const reg = regWith(def);
    const plan = resolvePlatformPlan("codex", "detection", "linux", reg);
    assert.equal(plan?.status, "supported");
  });
});

describe("v1.5 plan APIs", () => {
  const reg = regWith(v15Tool());

  it("getSkillPlan exposes roots/markers/maxDepth (TC-SKL-001 plan layer)", () => {
    const plan = getSkillPlan("v15-tool", undefined, reg);
    assert.deepEqual(plan?.roots, [".v15/skills"]);
    assert.deepEqual(plan?.markers, ["SKILL.md"]);
    assert.equal(plan?.maxDepth, 3);
    assert.equal(getSkillPlan("no-such-tool", undefined, reg), null);
  });

  it("getContextPlan exposes the native reader", () => {
    const ctx = getContextPlan("v15-tool", reg);
    assert.equal(ctx?.mode, "native");
    assert.equal(ctx?.reader, "codex-context-v1");
  });

  it("listSessionTools returns resume-capable tools", () => {
    const ids = listSessionTools(reg);
    assert.deepEqual(ids, ["v15-tool"]);
  });
});

describe("canonical source & version hash (D6, TC-REG-004 plan layer)", () => {
  it("a display change alters the canonical source (full coverage)", () => {
    const a = codexLike();
    const b = codexLike();
    b.display.nameZh = "变更名称";
    const regA = compileToolRegistry([a]);
    const regB = compileToolRegistry([b]);
    assert.notEqual(regA.canonicalSource, regB.canonicalSource);
    assert.notEqual(
      computeToolRegistryVersion(regA),
      computeToolRegistryVersion(regB),
    );
  });

  it("toolRegistryVersion equals the cache fingerprint", () => {
    const reg = compileToolRegistry([codexLike()]);
    assert.equal(
      computeToolRegistryVersion(reg),
      computeRegistryFingerprint(reg),
    );
  });
});

describe("manifest v1.5 tokens are forbidden (TC-REG-003)", () => {
  it("rejects v1.5 path/pricing fields in the public manifest", () => {
    const leaky = {
      configVersion: 1,
      tools: [
        {
          id: "x",
          name: "X",
          nameZh: "X",
          capabilities: { usage: "unsupported" },
          locations: [{ targets: ["macos"], base: "appData", path: "x" }],
          pricing: { billingMode: "api-metered", rulePackRefs: ["openai"] },
        },
      ],
    } as unknown as Parameters<typeof manifestIsSafe>[0];
    assert.equal(manifestIsSafe(leaky), false);
  });

  it("the generated manifest stays safe after the new tokens", () => {
    const reg = compileToolRegistry([codexLike(), v15Tool()]);
    const manifest = generatePublicManifest(reg.definitions);
    assert.equal(manifestIsSafe(manifest), true);
  });
});
