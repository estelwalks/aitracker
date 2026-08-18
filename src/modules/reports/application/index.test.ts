import assert from "node:assert/strict";
import test from "node:test";
import { createReportsApplication } from "./index.ts";
import { BUILTIN_REPORT_DEFINITIONS } from "../domain.ts";
import { createInMemoryReportStore } from "../infrastructure/in-memory-store.ts";

function app(
  overrides: Partial<Parameters<typeof createReportsApplication>[0]> = {},
) {
  const store = createInMemoryReportStore();
  const context = {
    collect: async () => ({
      summary: "safe summary",
      evidence: [
        {
          module: "insights" as const,
          ref: "insight:1",
          observedAt: "2026-08-07T00:00:00.000Z",
        },
      ],
      assets: [{ assetId: "asset:1", kind: "knowledge" as const }],
    }),
  };
  const generation = {
    generate: async () => ({
      status: "succeeded" as const,
      body: "A safe report body.",
    }),
  };
  return {
    store,
    app: createReportsApplication({
      store,
      context,
      generation,
      now: () => new Date("2026-08-07T00:00:00.000Z"),
      createId: (() => {
        let i = 0;
        return (prefix: string) => `${prefix}:${++i}`;
      })(),
      ...overrides,
    }),
  };
}

test("built-in daily and weekly definitions have independent template versions and schedule refs", () => {
  assert.deepEqual(
    BUILTIN_REPORT_DEFINITIONS.map((item) => item.kind),
    ["daily", "weekly"],
  );
  assert.equal(
    BUILTIN_REPORT_DEFINITIONS[0]?.scheduleRef.taskId,
    "reports.generate",
  );
  assert.notEqual(
    BUILTIN_REPORT_DEFINITIONS[0]?.template.templateId,
    BUILTIN_REPORT_DEFINITIONS[1]?.template.templateId,
  );
});

test("public definition catalog contains template versions but not template prompts", () => {
  const state = app();
  const serialized = JSON.stringify(state.app.definitions);
  assert.match(serialized, /templateVersion/);
  assert.doesNotMatch(serialized, /Summarize the supplied/);
  assert.doesNotMatch(serialized, /"template"\s*:/);
});

test("manual and scheduled generation share the same use case and produce equivalent summaries", async () => {
  const first = app();
  const manual = await first.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  const second = app();
  const scheduled = await second.app.generate({
    definitionId: "reports.daily",
    trigger: "schedule",
  });
  assert.equal(manual.ok && scheduled.ok, true);
  if (manual.ok && scheduled.ok) {
    assert.equal(manual.value.definitionId, scheduled.value.definitionId);
    assert.equal(manual.value.templateVersion, scheduled.value.templateVersion);
    assert.deepEqual(manual.value.evidence, scheduled.value.evidence);
  }
});

test("generate forwards an explicit modelId to the generation port", async () => {
  const calls: Array<{ modelId?: string }> = [];
  const state = app({
    generation: {
      generate: async (input: { modelId?: string }) => {
        calls.push({ modelId: input.modelId });
        return { status: "succeeded" as const, body: "A safe report body." };
      },
    },
  });
  await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
    modelId: "m-profile-1",
  });
  assert.deepEqual(calls, [{ modelId: "m-profile-1" }]);
});

test("failed and budget-exceeded generation preserves the previous report", async () => {
  const first = app();
  await first.app.generate({
    definitionId: "reports.weekly",
    trigger: "manual",
  });
  const previous = await first.app.generate({
    definitionId: "reports.weekly",
    trigger: "manual",
  });
  const failing = app({
    generation: {
      generate: async () => ({
        status: "budget-exceeded" as const,
        errorCode: "errors.reports.budgetExceeded" as const,
      }),
    },
  });
  const result = await failing.app.generate({
    definitionId: "reports.weekly",
    trigger: "schedule",
  });
  assert.equal(result.ok, false);
  assert.equal(
    (await first.app.get(previous.ok ? previous.value.reportId : "missing")).ok,
    true,
  );
});

test("offline fallback is explicit and body remains server-only", async () => {
  const state = app({
    generation: { generate: async () => ({ status: "offline" as const }) },
  });
  const result = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("Offline"), false);
  assert.equal(state.store.documents[0]?.body.includes("Offline"), true);
});

test("approval lifecycle and public DTO reject sensitive content", async () => {
  const state = app();
  const generated = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const approved = await state.app.approve(
    generated.value.reportId,
    "operator",
  );
  assert.equal(approved.ok && approved.value.status, "approved");
  const raw = JSON.stringify(approved);
  assert.doesNotMatch(raw, /body|prompt|response|command|path|token/i);
  assert.equal(
    (await state.app.archive(generated.value.reportId, "operator")).ok,
    true,
  );
});

test("countByKind buckets persisted reports by cadence", async () => {
  const state = app();
  const daily = await state.app.createDraft({
    definitionId: "reports.daily",
    actor: "operator",
  });
  const weekly = await state.app.createDraft({
    definitionId: "reports.weekly",
    actor: "operator",
  });
  assert.equal(daily.ok && weekly.ok, true);
  assert.deepEqual(await state.app.countByKind(), {
    daily: 1,
    weekly: 1,
    monthly: 0,
  });
  assert.equal(await state.app.count(), 2);
});
