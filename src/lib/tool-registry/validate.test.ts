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
