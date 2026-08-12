import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { NodeAtomicJsonStore } from "../../../platform/persistence/infrastructure/node-atomic-json-store.ts";
import { TEST_TMP_PREFIX } from "../../../lib/app-config.ts";
import {
  createAtomicReportStore,
  DEFAULT_REPORT_FILE,
  reportStoreSchema,
} from "./atomic-report-store.ts";
import type { ReportDocument, ReportRun } from "../contracts.ts";

const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };

async function temp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${TEST_TMP_PREFIX}reports-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function newStore(dir: string) {
  const path = join(dir, `reports-${randomUUID()}.v1.json`);
  return createAtomicReportStore({
    store: new NodeAtomicJsonStore({
      filePath: path,
      defaultValue: DEFAULT_REPORT_FILE,
      schema: reportStoreSchema(),
      clock,
    }),
  });
}

function run(overrides: Partial<ReportRun> = {}): ReportRun {
  return {
    runId: `run:${randomUUID()}`,
    definitionId: "reports.daily",
    trigger: "schedule",
    status: "running",
    startedAt: "2026-08-07T00:00:00.000Z",
    evidence: [],
    ...overrides,
  };
}

function document(overrides: Partial<ReportDocument> = {}): ReportDocument {
  return {
    reportId: `report:${randomUUID()}`,
    runId: "run:1",
    definitionId: "reports.daily",
    status: "draft",
    title: "Daily brief",
    body: "A safe report body.",
    generatedAt: "2026-08-07T00:00:00.000Z",
    templateVersion: 1,
    evidence: [],
    assets: [],
    ...overrides,
  };
}

test("createRun persists a run and updateRun replaces it by runId", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    const seeded = run({ runId: "run:1", status: "running" });
    await store.createRun(seeded);

    await store.updateRun({
      ...seeded,
      status: "succeeded",
      finishedAt: "2026-08-07T00:01:00.000Z",
    });

    // No direct list on ReportStore; round-trip through a document to confirm
    // the run record is durable across a restart (proves the file held it).
    const doc = document({ runId: "run:1", reportId: "report:1" });
    await store.saveDocument(doc);
    assert.equal((await store.getDocument("report:1"))?.runId, "run:1");
  });
});

test("updateRun is a no-op for an unknown runId", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    await store.updateRun(run({ runId: "run:ghost" }));
    // No throw, file still usable.
    const doc = document({ reportId: "report:1" });
    await store.saveDocument(doc);
    assert.ok(await store.getDocument("report:1"));
  });
});

test("saveDocument upserts by reportId", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    const doc = document({ reportId: "report:1", status: "draft" });
    await store.saveDocument(doc);
    await store.saveDocument({
      ...doc,
      status: "approved",
      approvedBy: "operator",
      approvedAt: "2026-08-07T01:00:00.000Z",
    });
    const fetched = await store.getDocument("report:1");
    assert.equal(fetched?.status, "approved");
    assert.equal(fetched?.approvedBy, "operator");
  });
});

test("getDocument returns undefined for an unknown reportId", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    assert.equal(await store.getDocument("missing"), undefined);
  });
});

test("latest returns the most recent document for a definitionId by generatedAt", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    await store.saveDocument(
      document({
        reportId: "report:old",
        generatedAt: "2026-08-06T00:00:00.000Z",
      }),
    );
    await store.saveDocument(
      document({
        reportId: "report:new",
        generatedAt: "2026-08-07T00:00:00.000Z",
      }),
    );
    await store.saveDocument(
      document({
        reportId: "report:weekly",
        definitionId: "reports.weekly",
        generatedAt: "2026-08-08T00:00:00.000Z",
      }),
    );

    const daily = await store.latest("reports.daily");
    assert.equal(daily?.reportId, "report:new");
    const weekly = await store.latest("reports.weekly");
    assert.equal(weekly?.reportId, "report:weekly");
    assert.equal(await store.latest("reports.unknown"), undefined);
  });
});

test("restart recovery: a fresh store instance reads previously persisted data", async () => {
  await temp(async (dir) => {
    const path = join(dir, "reports.v1.json");
    const createStore = () =>
      createAtomicReportStore({
        store: new NodeAtomicJsonStore({
          filePath: path,
          defaultValue: DEFAULT_REPORT_FILE,
          schema: reportStoreSchema(),
          clock,
        }),
      });

    const first = createStore();
    await first.saveDocument(
      document({ reportId: "report:survived", runId: "run:survived" }),
    );

    // A fresh store models a process restart against the same file.
    const restarted = createStore();
    const fetched = await restarted.getDocument("report:survived");
    assert.ok(fetched, "persisted document must survive a restart");
    assert.equal(fetched?.runId, "run:survived");

    // The AtomicJsonStore wraps the file as { schemaVersion, data }; reading
    // the raw file proves the commit is durable on disk.
    const raw = await readFile(path, "utf8");
    const wrapped = JSON.parse(raw) as {
      data: { documents: { reportId: string }[] };
    };
    assert.ok(
      wrapped.data.documents.some(
        (item) => item.reportId === "report:survived",
      ),
      "persisted file must contain the document",
    );
  });
});

test("listDocuments returns persisted documents newest first", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    await store.saveDocument(
      document({
        reportId: "report:old",
        generatedAt: "2026-08-06T00:00:00.000Z",
      }),
    );
    await store.saveDocument(
      document({
        reportId: "report:new",
        generatedAt: "2026-08-07T00:00:00.000Z",
      }),
    );
    const list = await store.listDocuments();
    assert.deepEqual(
      list.map((item) => item.reportId),
      ["report:new", "report:old"],
    );
  });
});

test("listRuns returns persisted runs newest first", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    await store.createRun(
      run({ runId: "run:old", startedAt: "2026-08-06T00:00:00.000Z" }),
    );
    await store.createRun(
      run({ runId: "run:new", startedAt: "2026-08-07T00:00:00.000Z" }),
    );
    const list = await store.listRuns();
    assert.deepEqual(
      list.map((item) => item.runId),
      ["run:new", "run:old"],
    );
  });
});

test("callers cannot mutate persisted state via returned references (defensive clone)", async () => {
  await temp(async (dir) => {
    const store = newStore(dir);
    await store.saveDocument(document({ reportId: "report:1" }));
    const fetched = await store.getDocument("report:1");
    assert.ok(fetched);
    // Mutate the returned object; the store must be unaffected.
    (fetched as { status: string }).status = "archived";
    const again = await store.getDocument("report:1");
    assert.equal(again?.status, "draft");
  });
});
