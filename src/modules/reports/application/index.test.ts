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
    "reports.generate.daily",
  );
  assert.equal(
    BUILTIN_REPORT_DEFINITIONS[1]?.scheduleRef.taskId,
    "reports.generate.weekly",
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

test("regenerating the same period replaces the previous report", async () => {
  let attempt = 0;
  const state = app({
    generation: {
      generate: async () => {
        attempt += 1;
        return {
          status: "succeeded" as const,
          body: `Report body ${attempt}.`,
        };
      },
    },
  });
  const period = { granularity: "day" as const, key: "2026-08-07" };
  const first = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
    period,
  });
  const second = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
    period,
  });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  const listed = await state.app.list();
  assert.equal(listed.ok && listed.value.length, 1);
  assert.equal(listed.ok && listed.value[0]?.reportId, second.value.reportId);
  assert.equal((await state.app.get(first.value.reportId)).ok, false);
  const content = await state.app.readContent(second.value.reportId);
  assert.equal(content.ok && content.value.body, "Report body 2.");
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

test("failed and budget-exceeded generation returns the current error while preserving the previous report", async () => {
  for (const failure of [
    {
      status: "failed" as const,
      errorCode: "errors.reports.generationFailed" as const,
    },
    {
      status: "budget-exceeded" as const,
      errorCode: "errors.reports.budgetExceeded" as const,
    },
  ]) {
    let attempt = 0;
    const state = app({
      generation: {
        generate: async () => {
          attempt += 1;
          return attempt === 1
            ? ({ status: "succeeded", body: "Previous report body." } as const)
            : failure;
        },
      },
    });
    const previous = await state.app.generate({
      definitionId: "reports.weekly",
      trigger: "manual",
    });
    assert.equal(previous.ok, true);
    if (!previous.ok) continue;

    const result = await state.app.generate({
      definitionId: "reports.weekly",
      trigger: "schedule",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, failure.errorCode);

    const listed = await state.app.list();
    assert.equal(listed.ok && listed.value.length, 1);
    assert.equal((await state.app.get(previous.value.reportId)).ok, true);
    const content = await state.app.readContent(previous.value.reportId);
    assert.equal(content.ok && content.value.body, "Previous report body.");
  }
});

test("context collection failure returns the current error while preserving the previous report", async () => {
  let attempt = 0;
  const state = app({
    context: {
      collect: async () => {
        attempt += 1;
        if (attempt === 2) throw new Error("context unavailable");
        return {
          summary: "safe summary",
          evidence: [
            {
              module: "insights" as const,
              ref: "insight:1",
              observedAt: "2026-08-07T00:00:00.000Z",
            },
          ],
        };
      },
    },
  });
  const previous = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(previous.ok, true);
  if (!previous.ok) return;

  const result = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.error.code, "errors.reports.contextFailed");

  const listed = await state.app.list();
  assert.equal(listed.ok && listed.value.length, 1);
  assert.equal((await state.app.get(previous.value.reportId)).ok, true);
  const content = await state.app.readContent(previous.value.reportId);
  assert.equal(content.ok && content.value.body, "A safe report body.");
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
  assert.equal(state.store.documents[0]?.body, undefined);
  assert.match(state.store.documents[0]?.contentFile ?? "", /\.md$/);
  if (result.ok) {
    const content = await state.app.readContent(result.value.reportId);
    assert.equal(content.ok && content.value.body.includes("Offline"), true);
  }
});

test("saving an edit writes a new content revision and readContent returns it", async () => {
  const state = app();
  const generated = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  const before = state.store.documents[0]?.contentFile;
  const saved = await state.app.saveContent(
    generated.value.reportId,
    "# Edited report\n\nLocally persisted.",
  );
  assert.equal(saved.ok, true);
  assert.notEqual(state.store.documents[0]?.contentFile, before);
  const read = await state.app.readContent(generated.value.reportId);
  assert.equal(
    read.ok && read.value.body,
    "# Edited report\n\nLocally persisted.",
  );
});

test("P1-10: an inline body over the storage boundary returns an explicit truncation signal", async () => {
  const state = app({ inlineContent: true });
  const generated = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;

  const large = await state.app.saveContent(
    generated.value.reportId,
    `# 长正文\n\n${"x".repeat(70_000)}`,
  );
  assert.equal(large.ok, true);
  assert.equal(large.ok && large.value.truncated, true);

  // A body within the boundary is not flagged.
  const short = await state.app.saveContent(
    generated.value.reportId,
    "# 短正文",
  );
  assert.equal(short.ok, true);
  assert.equal(short.ok && short.value.truncated, undefined);
});

test("legacy inline bodies remain readable and migrate to a file reference", async () => {
  const state = app();
  await state.store.saveDocument({
    reportId: "report:legacy",
    runId: "run:legacy",
    definitionId: "reports.daily",
    status: "draft",
    title: "Legacy daily",
    body: "# Legacy body",
    generatedAt: "2026-08-07T00:00:00.000Z",
    templateVersion: 1,
    evidence: [],
    assets: [],
  });
  const read = await state.app.readContent("report:legacy");
  assert.equal(read.ok && read.value.body, "# Legacy body");
  const migrated = await state.store.getDocument("report:legacy");
  assert.equal(migrated?.body, undefined);
  assert.match(migrated?.contentFile ?? "", /\.md$/);
});

test("list sequentially migrates every legacy body before returning summaries", async () => {
  const state = app();
  for (const [index, generatedAt] of [
    "2026-08-06T00:00:00.000Z",
    "2026-08-07T00:00:00.000Z",
  ].entries()) {
    await state.store.saveDocument({
      reportId: `report:legacy-${index + 1}`,
      runId: `run:legacy-${index + 1}`,
      definitionId: index === 0 ? "reports.daily" : "reports.weekly",
      status: "draft",
      title: `Legacy ${index + 1}`,
      body: `# Legacy body ${index + 1}`,
      generatedAt,
      templateVersion: 1,
      evidence: [],
      assets: [],
    });
  }

  const listed = await state.app.list();
  assert.equal(listed.ok && listed.value.length, 2);
  const migrated = await state.store.listDocuments();
  assert.equal(
    migrated.every((item) => item.body === undefined),
    true,
  );
  assert.equal(
    migrated.every((item) => Boolean(item.contentFile?.endsWith(".md"))),
    true,
  );
  for (const item of migrated) {
    const content = await state.app.readContent(item.reportId);
    assert.equal(content.ok, true);
  }
});

test("list keeps all summaries when one legacy migration fails", async () => {
  const state = app({
    content: {
      create: async (document, body) => {
        if (document.reportId === "report:broken") throw new Error("disk full");
        return `${body.length}-${document.reportId.replace(":", "-")}.md`;
      },
      read: async () => "unused",
      replace: async () => "unused.md",
    },
  });
  for (const reportId of ["report:broken", "report:healthy"]) {
    await state.store.saveDocument({
      reportId,
      runId: `run:${reportId}`,
      definitionId: "reports.daily",
      status: "draft",
      title: reportId,
      body: "legacy",
      generatedAt: "2026-08-07T00:00:00.000Z",
      templateVersion: 1,
      evidence: [],
      assets: [],
    });
  }
  const listed = await state.app.list();
  assert.equal(listed.ok && listed.value.length, 2);
  assert.equal(
    (await state.store.getDocument("report:broken"))?.body,
    "legacy",
  );
  assert.equal(
    (await state.store.getDocument("report:healthy"))?.body,
    undefined,
  );
});

test("unknown report ids and invalid edited content are rejected", async () => {
  const state = app();
  assert.equal((await state.app.readContent("report:missing")).ok, false);
  assert.equal(
    (await state.app.saveContent("report:missing", "text")).ok,
    false,
  );
  const generated = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
  });
  assert.equal(generated.ok, true);
  if (!generated.ok) return;
  assert.equal(
    (await state.app.saveContent(generated.value.reportId, "bad\0body")).ok,
    false,
  );
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

test("generate with a period archives the report into that period", async () => {
  const state = app({ now: () => new Date("2026-08-19T12:00:00.000Z") });
  const result = await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
    period: { granularity: "day", key: "2026-08-15" },
  });
  assert.equal(result.ok, true);
  const doc = state.store.documents[0];
  assert.ok(doc);
  const generated = new Date(doc.generatedAt);
  // Local-time anchor inside the selected day (2026-08-15 midday).
  assert.equal(generated.getFullYear(), 2026);
  assert.equal(generated.getMonth(), 7);
  assert.equal(generated.getDate(), 15);
});

test("generate archives into the selected week/month anchor", async () => {
  const week = app();
  await week.app.generate({
    definitionId: "reports.weekly",
    trigger: "manual",
    period: { granularity: "week", key: "2026-08-10" },
  });
  const monday = new Date(week.store.documents[0]!.generatedAt);
  assert.equal(monday.getFullYear(), 2026);
  assert.equal(monday.getMonth(), 7);
  assert.equal(monday.getDate(), 10);

  const month = app();
  await month.app.generate({
    definitionId: "reports.weekly",
    trigger: "manual",
    period: { granularity: "month", key: "2026-03" },
  });
  const first = new Date(month.store.documents[0]!.generatedAt);
  assert.equal(first.getFullYear(), 2026);
  assert.equal(first.getMonth(), 2);
  assert.equal(first.getDate(), 1);
  assert.equal(month.store.documents[0]!.title, "Monthly review");
});

test("generate forwards the period to the context collector", async () => {
  const collected: unknown[] = [];
  const state = app({
    context: {
      collect: async (input: unknown) => {
        collected.push(input);
        return { summary: "safe summary", evidence: [] };
      },
    },
  });
  await state.app.generate({
    definitionId: "reports.daily",
    trigger: "manual",
    period: { granularity: "week", key: "2026-08-03" },
  });
  assert.deepEqual(collected, [
    {
      definition: BUILTIN_REPORT_DEFINITIONS[0],
      period: { granularity: "week", key: "2026-08-03" },
    },
  ]);
});
