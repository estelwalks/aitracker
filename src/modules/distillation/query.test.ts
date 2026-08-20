import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../lib/errors.ts";
import { validateStartDistillationInput } from "./query.ts";

const base = {
  sessionRefs: [{ source: "codex", sessionId: "s1" }],
};

test("start distillation validator normalizes refs, model and prompt", () => {
  const result = validateStartDistillationInput({
    ...base,
    modelId: "  model-a  ",
    promptText: "  Summarize  ",
  });
  assert.deepEqual(result, {
    sessionRefs: [{ source: "codex", sessionId: "s1" }],
    modelId: "model-a",
    promptText: "Summarize",
  });
});

test("start distillation validator forwards valid user-selected segments", () => {
  const result = validateStartDistillationInput({
    ...base,
    segments: [
      { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 4 },
    ],
  });
  assert.deepEqual(result.segments, [
    { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 4 },
  ]);
});

test("start distillation validator accepts more than the former 8-selection cap", () => {
  const refs = Array.from({ length: 12 }, (_, i) => ({
    source: "codex",
    sessionId: `s${i}`,
  }));
  const segments = Array.from({ length: 12 }, (_, i) => ({
    source: "codex",
    sessionId: `s${i}`,
    startIndex: i,
    endIndex: i,
  }));
  const result = validateStartDistillationInput({
    sessionRefs: refs,
    segments,
  });
  assert.equal(result.sessionRefs.length, 12);
  assert.equal(result.segments?.length, 12);
});

test("start distillation validator rejects malformed segments", () => {
  const malformed = [
    // Non-array.
    { ...base, segments: "not-an-array" },
    // Empty array.
    { ...base, segments: [] },
    // Negative window bound.
    {
      ...base,
      segments: [
        { source: "codex", sessionId: "s1", startIndex: -1, endIndex: 2 },
      ],
    },
    // Inverted window.
    {
      ...base,
      segments: [
        { source: "codex", sessionId: "s1", startIndex: 3, endIndex: 1 },
      ],
    },
    // Non-integer bound.
    {
      ...base,
      segments: [
        { source: "codex", sessionId: "s1", startIndex: 0.5, endIndex: 2 },
      ],
    },
    // Non-opaque source.
    {
      ...base,
      segments: [
        { source: "../codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
      ],
    },
    // Missing sessionId.
    {
      ...base,
      segments: [{ source: "codex", startIndex: 0, endIndex: 1 }],
    },
    // Duplicate windows.
    {
      ...base,
      segments: [
        { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
        { source: "codex", sessionId: "s1", startIndex: 0, endIndex: 1 },
      ],
    },
  ];
  for (const input of malformed) {
    assert.throws(
      () => validateStartDistillationInput(input),
      AppError,
      `expected rejection for ${JSON.stringify(input.segments)}`,
    );
  }
});

test("start distillation validator still rejects invalid session refs", () => {
  assert.throws(
    () => validateStartDistillationInput({ sessionRefs: [] }),
    AppError,
  );
  assert.throws(
    () =>
      validateStartDistillationInput({
        sessionRefs: [{ source: "../codex", sessionId: "s1" }],
      }),
    AppError,
  );
  assert.throws(
    () =>
      validateStartDistillationInput({
        sessionRefs: [
          { source: "codex", sessionId: "s1" },
          { source: "codex", sessionId: "s1" },
        ],
      }),
    AppError,
  );
});
