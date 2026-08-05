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
