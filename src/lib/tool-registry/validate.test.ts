import assert from "node:assert/strict";
import test from "node:test";

import type { ToolDefinition } from "./contracts.ts";
import { validateToolDefinitions, isValid } from "./validate.ts";

function validDef(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "codex",
    configVersion: 1,
    display: { name: "Codex CLI", nameZh: "Codex CLI" },
    detection: { roots: [".codex"] },
    capabilities: {
      usage: { mode: "unsupported" },
      skills: { mode: "unsupported" },
      agents: { mode: "unsupported" },
      sessions: { mode: "unsupported" },
      market: { mode: "unsupported" },
      security: { mode: "unsupported" },
    },
    ...overrides,
  };
}

function codes(defs: readonly ToolDefinition[]): string[] {
  return validateToolDefinitions(defs)
    .filter((d) => d.severity === "error")
    .map((d) => d.code);
}

test("a valid definition produces no error diagnostics", () => {
  assert.deepEqual(codes([validDef()]), []);
  assert.equal(isValid([validDef()]), true);
});

test("duplicate ids are reported", () => {
  const diag = codes([validDef(), validDef()]);
  assert.ok(diag.includes("duplicate-id"));
  assert.equal(isValid([validDef(), validDef()]), false);
});

test("non-kebab ids are reported", () => {
  assert.ok(codes([validDef({ id: "Codex" })]).includes("invalid-id"));
  assert.ok(codes([validDef({ id: "1bad" })]).includes("invalid-id"));
});

test("absolute, traversing and NUL detection roots are unsafe", () => {
  assert.ok(
    codes([validDef({ detection: { roots: ["/etc"] } })]).includes(
      "unsafe-detection-root",
    ),
  );
  assert.ok(
    codes([validDef({ detection: { roots: ["../x"] } })]).includes(
      "unsafe-detection-root",
    ),
  );
  assert.ok(
    codes([validDef({ detection: { roots: ["a\0b"] } })]).includes(
      "unsafe-detection-root",
    ),
  );
});

test("unsafe skill roots and invalid envHome are reported", () => {
  const def = validDef({
    storage: { skills: { roots: ["../evil"], envHome: "bad-name" } },
    capabilities: {
      ...validDef().capabilities,
      skills: { mode: "read-write" },
    },
  });
  const diag = codes([def]);
  assert.ok(diag.includes("unsafe-skill-root"));
  assert.ok(diag.includes("invalid-env-home"));
});

test("usage mode native requires a known reader and paths", () => {
  const missing = codes([
    validDef({
      capabilities: { ...validDef().capabilities, usage: { mode: "native" } },
    }),
  ]);
  assert.ok(missing.includes("usage-missing-reader"));
  assert.ok(missing.includes("usage-missing-paths"));

  const unknown = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        usage: {
          mode: "native",
          reader: "no-such-reader" as never,
          paths: [{ root: ".x", glob: "*.jsonl", format: "jsonl" }],
        },
      },
    }),
  ]);
  assert.ok(unknown.includes("unknown-usage-reader"));

  const good = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        usage: {
          mode: "native",
          reader: "codex-rollout-v1",
          paths: [
            { root: ".codex/sessions", glob: "**/*.jsonl", format: "jsonl" },
          ],
        },
      },
    }),
  ]);
  assert.deepEqual(good, []);
});

test("usage unsupported must not declare reader or paths", () => {
  const diag = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        usage: {
          mode: "unsupported",
          reader: "codex-rollout-v1",
          paths: [{ root: ".x", glob: "*.jsonl", format: "jsonl" }],
        },
      },
    }),
  ]);
  assert.ok(diag.includes("unsupported-usage-has-reader"));
});

test("sessions resume requires reader, command with placeholder, known reader", () => {
  const missing = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        sessions: { mode: "resume" },
      },
    }),
  ]);
  assert.ok(missing.includes("sessions-missing-reader"));
  assert.ok(missing.includes("sessions-missing-command"));

  const noPlaceholder = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        sessions: {
          mode: "resume",
          reader: "codex-session-v1",
          command: ["codex", "resume"],
        },
      },
    }),
  ]);
  assert.ok(noPlaceholder.includes("sessions-command-no-placeholder"));

  const unknownReader = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        sessions: {
          mode: "resume",
          reader: "nope" as never,
          command: ["codex", "resume", "{sessionId}"],
        },
      },
    }),
  ]);
  assert.ok(unknownReader.includes("unknown-session-reader"));

  const good = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        sessions: {
          mode: "resume",
          reader: "codex-session-v1",
          command: ["codex", "resume", "{sessionId}"],
        },
      },
    }),
  ]);
  assert.deepEqual(good, []);
});

test("market install-target requires read-write skills with roots", () => {
  const diag = codes([
    validDef({
      capabilities: {
        ...validDef().capabilities,
        market: { mode: "install-target" },
      },
    }),
  ]);
  assert.ok(diag.includes("market-without-skills"));
});

test("agents read requires agent storage roots", () => {
  const diag = codes([
    validDef({
      capabilities: { ...validDef().capabilities, agents: { mode: "read" } },
    }),
  ]);
  assert.ok(diag.includes("agents-read-without-storage"));
});

test("pricing duplicate rule ids and invalid dates are reported", () => {
  const def = validDef({
    pricing: {
      provider: "openai",
      rules: [
        {
          id: "r1",
          label: "R1",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-x"] },
        },
        {
          id: "r1",
          label: "R1",
          effectiveFrom: "bad-date",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-y"] },
        },
      ],
    },
  });
  const diag = codes([def]);
  assert.ok(diag.includes("duplicate-price-rule"));
  assert.ok(diag.includes("invalid-effective-from"));
});

test("pricing same-priority overlap on shared model is reported", () => {
  const def = validDef({
    pricing: {
      provider: "openai",
      rules: [
        {
          id: "r1",
          label: "R1",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
        {
          id: "r2",
          label: "R2",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 4,
          cacheReadUsdPerMillion: 0.2,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
      ],
    },
  });
  assert.ok(codes([def]).includes("price-rule-overlap"));
});

test("pricing different-priority same model is NOT an overlap", () => {
  const def = validDef({
    pricing: {
      provider: "openai",
      rules: [
        {
          id: "r1",
          label: "R1",
          priority: 1,
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
        {
          id: "r2",
          label: "R2",
          priority: 0,
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 4,
          cacheReadUsdPerMillion: 0.2,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["gpt-5"] },
        },
      ],
    },
  });
  assert.ok(!codes([def]).includes("price-rule-overlap"));
});

test("pricing includesAll vs exactOrSnapshot overlap is detected", () => {
  const def = validDef({
    pricing: {
      provider: "anthropic",
      rules: [
        {
          id: "specific",
          label: "S",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "exactOrSnapshot", names: ["claude-opus-4"] },
        },
        {
          id: "general",
          label: "G",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 4,
          cacheReadUsdPerMillion: 0.2,
          cacheWriteUsdPerMillion: null,
          match: { kind: "includesAll", parts: ["claude", "opus"] },
        },
      ],
    },
  });
  assert.ok(codes([def]).includes("price-rule-overlap"));
});

test("disjoint includesAll rules (opus vs sonnet) are NOT an overlap", () => {
  const def = validDef({
    pricing: {
      provider: "anthropic",
      rules: [
        {
          id: "opus",
          label: "O",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 1,
          outputUsdPerMillion: 2,
          cacheReadUsdPerMillion: 0.1,
          cacheWriteUsdPerMillion: null,
          match: { kind: "includesAll", parts: ["claude", "opus"] },
        },
        {
          id: "sonnet",
          label: "SN",
          effectiveFrom: "2026-01-01",
          inputUsdPerMillion: 3,
          outputUsdPerMillion: 4,
          cacheReadUsdPerMillion: 0.2,
          cacheWriteUsdPerMillion: null,
          match: { kind: "includesAll", parts: ["claude", "sonnet"] },
        },
      ],
    },
  });
  assert.ok(!codes([def]).includes("price-rule-overlap"));
});
