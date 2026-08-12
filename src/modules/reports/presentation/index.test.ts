import assert from "node:assert/strict";
import test from "node:test";
import { ok } from "../../../shared/result.ts";
import type { KnowledgeAsset } from "../../knowledge/contracts.ts";
import type {
  ReportDefinitionSummary,
  ReportRun,
  ReportSummary,
  ReportsApplication,
} from "../contracts.ts";
import { createReportsPresentation } from "./index.ts";

const definitions: readonly ReportDefinitionSummary[] = [
  {
    definitionId: "reports.daily",
    kind: "daily",
    title: "Daily brief",
    templateVersion: 2,
    scheduleRef: { taskId: "reports.generate", scheduleId: "reports.daily" },
    enabled: true,
  },
];

const report = (overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  reportId: "report:old",
  runId: "run:old",
  definitionId: "reports.daily",
  kind: "daily",
  status: "approved",
  title: "Daily brief",
  generatedAt: "2026-08-07T00:00:00.000Z",
  templateVersion: 2,
  evidence: [
    {
      module: "usage",
      ref: "usage:day",
      observedAt: "2026-08-07T00:00:00.000Z",
    },
  ],
  assets: [{ assetId: "asset:memory", kind: "knowledge" }],
  ...overrides,
});

const app = (): ReportsApplication => ({
  definitions,
  createDraft: async () => {
    throw new Error("unused");
  },
  generate: async () => {
    throw new Error("unused");
  },
  get: async () => {
    throw new Error("unused");
  },
  approve: async () => {
    throw new Error("unused");
  },
  archive: async () => {
    throw new Error("unused");
  },
  list: async () => {
    throw new Error("unused");
  },
  listRuns: async () => {
    throw new Error("unused");
  },
  count: async () => null,
});

const run = (overrides: Partial<ReportRun> = {}): ReportRun => ({
  runId: "run:latest",
  definitionId: "reports.daily",
  trigger: "manual",
  status: "running",
  startedAt: "2026-08-07T01:00:00.000Z",
  evidence: [],
  ...overrides,
});

const memory: KnowledgeAsset = {
  assetId: "asset:memory",
  kind: "memory",
  title: "Safe memory",
  currentVersion: 3,
  status: "published",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
};

test("maps running, waiting approval, published and stale statuses", async () => {
  const source = {
    listReports: async () => [
      report({ generatedAt: "2026-08-07T01:30:00.000Z" }),
      report({
        reportId: "report:draft",
        runId: "run:draft",
        status: "draft",
        generatedAt: "2026-08-07T01:30:00.000Z",
      }),
      report({
        reportId: "report:stale",
        runId: "run:stale",
        generatedAt: "2026-08-01T00:00:00.000Z",
      }),
    ],
    listRuns: async () => [
      run({ runId: "run:active", status: "running" }),
      run({ runId: "run:draft", status: "succeeded" }),
    ],
  };
  const query = createReportsPresentation({
    reports: app(),
    source,
    now: () => new Date("2026-08-07T02:00:00.000Z"),
    staleAfterMs: 60 * 60 * 1000,
  });
  const result = await query.query();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const statuses = result.value.feed.reports.map((item) => item.status);
  assert.equal(statuses.includes("published"), true);
  assert.equal(statuses.includes("waiting-approval"), true);
  assert.equal(statuses.includes("running"), true);
  assert.equal(statuses.includes("stale"), true);
  assert.equal(result.value.feed.reports[0]?.assetCount, 1);
});

test("retains a failed run alongside the previous report and keeps renderer payload private", async () => {
  const query = createReportsPresentation({
    reports: app(),
    source: {
      listReports: async () => [report()],
      listRuns: async () => [
        run({
          runId: "run:new",
          status: "failed",
          errorCode: "errors.reports.generationFailed",
          retryable: true,
        }),
      ],
    },
    knowledge: { list: async () => ok([memory]) },
    offline: true,
    disabled: false,
  });
  const result = await query.query({ reportId: "report:old" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.feed.reports.length, 2);
  assert.equal(
    result.value.feed.reports.some((item) => item.status === "failed"),
    true,
  );
  assert.deepEqual(result.value.feed.memories, [
    {
      assetId: "asset:memory",
      kind: "memory",
      title: "Safe memory",
      version: 3,
      status: "published",
      updatedAt: "2026-08-07T00:00:00.000Z",
    },
  ]);
  assert.equal(result.value.feed.offline, true);
  const serialized = JSON.stringify(result.value);
  assert.doesNotMatch(
    serialized,
    /body|prompt|command|path|rawError|secret|token/i,
  );
  assert.match(serialized, /errors\.reports\.generationFailed/);
});

test("drops unsafe opaque references from the detail DTO", async () => {
  const query = createReportsPresentation({
    reports: app(),
    source: {
      listReports: async () => [
        report({
          assets: [{ assetId: "/Users/private/report.md", kind: "attachment" }],
          evidence: [
            {
              module: "usage",
              ref: "C:\\private\\usage.json",
              observedAt: "2026-08-07T00:00:00.000Z",
            },
          ],
        }),
      ],
      listRuns: async () => [],
    },
  });
  const result = await query.query({ reportId: "report:old" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.selected?.assets, []);
  assert.deepEqual(result.value.selected?.evidence, []);
});

test("immediate generation is delegated through the public reports application", async () => {
  let received: unknown;
  const reports = {
    ...app(),
    generate: async (input: unknown) => {
      received = input;
      return ok(report({ reportId: "report:new" }));
    },
  } as ReportsApplication;
  const query = createReportsPresentation({
    reports,
    source: { listReports: async () => [], listRuns: async () => [] },
  });
  const result = await query.generateNow({ definitionId: "reports.daily" });
  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    definitionId: "reports.daily",
    trigger: "manual",
  });
});

test("offline and disabled modes never invoke generation", async () => {
  let calls = 0;
  const reports = {
    ...app(),
    generate: async () => {
      calls += 1;
      return ok(report({ reportId: "report:new" }));
    },
  } as ReportsApplication;
  const source = { listReports: async () => [], listRuns: async () => [] };
  const offline = createReportsPresentation({ reports, source, offline: true });
  const disabled = createReportsPresentation({
    reports,
    source,
    disabled: true,
  });
  const offlineResult = await offline.generateNow({
    definitionId: "reports.daily",
  });
  const disabledResult = await disabled.generateNow({
    definitionId: "reports.daily",
  });
  assert.equal(offlineResult.ok, false);
  assert.equal(disabledResult.ok, false);
  assert.equal(calls, 0);
});
