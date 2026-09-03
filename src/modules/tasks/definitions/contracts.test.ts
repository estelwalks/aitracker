import assert from "node:assert/strict";
import test from "node:test";
import rawPolicy from "../../../app/runtime-policy.source.json";
import { assertSafeStaticCatalog, JobCatalogSchema } from "./contracts";

const raw = {
  schemaVersion: rawPolicy.scheduledJobs.schemaVersion,
  tasks: rawPolicy.scheduledJobs.tasks,
};

test("job catalog accepts the embedded catalog", () => {
  assertSafeStaticCatalog(raw);
  // 10 baseline jobs + backup.daily + the background insight refresh.
  assert.equal(JobCatalogSchema.parse(raw).tasks.length, 12);
});

test("job catalog rejects duplicate ids and invalid schedules", () => {
  const invalid = structuredClone(raw) as typeof raw;
  invalid.tasks[1].id = invalid.tasks[0].id;
  invalid.tasks[0].defaultSchedule = { kind: "interval", minutes: 1 };
  assert.throws(() => JobCatalogSchema.parse(invalid));
});

test("job catalog rejects command, path, URL and code-shaped configuration", () => {
  assert.throws(() => assertSafeStaticCatalog({ command: "node scanner" }));
  assert.throws(() => assertSafeStaticCatalog({ path: "/tmp/file" }));
  assert.throws(() =>
    assertSafeStaticCatalog({ endpoint: "https://example.com" }),
  );
  assert.throws(() =>
    assertSafeStaticCatalog({ value: "() => process.exit()" }),
  );
});
