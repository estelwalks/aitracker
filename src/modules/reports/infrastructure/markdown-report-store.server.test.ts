import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TEST_TMP_PREFIX } from "../../../lib/app-config.ts";
import type { ReportDocument } from "../contracts.ts";
import { createMarkdownReportStore } from "./markdown-report-store.server.ts";

const document: ReportDocument = {
  reportId: "report:unit-1",
  runId: "run:unit-1",
  definitionId: "reports.daily",
  status: "draft",
  title: "Daily brief",
  generatedAt: "2026-08-19T12:00:00.000Z",
  templateVersion: 1,
  evidence: [],
  assets: [],
};

test("creates and replaces real Markdown files using immutable revisions", async () => {
  const root = await mkdtemp(join(tmpdir(), `${TEST_TMP_PREFIX}report-md-`));
  try {
    const store = createMarkdownReportStore({ rootDirectory: root });
    const first = await store.create(document, "# Generated");
    assert.match(first, /^2026-08-19-daily-report-unit-1-[\w-]+\.md$/);
    assert.equal(await readFile(join(root, first), "utf8"), "# Generated");
    const second = await store.replace(
      { ...document, contentFile: first },
      "# Edited",
    );
    assert.notEqual(second, first);
    assert.equal(await store.read(second), "# Edited");
    assert.equal(await store.read(first), "# Generated");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects traversal, malformed filenames, symlinks, NUL and oversized bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), `${TEST_TMP_PREFIX}report-md-`));
  const outside = join(root, "..", "outside-report.md");
  try {
    const store = createMarkdownReportStore({ rootDirectory: root });
    await assert.rejects(() => store.read("../outside-report.md"), TypeError);
    await assert.rejects(() => store.read("nested/report.md"), TypeError);
    await assert.rejects(() => store.read("report.txt"), TypeError);
    await symlink(outside, join(root, "linked.md"));
    await assert.rejects(() => store.read("linked.md"));
    await assert.rejects(() => store.create(document, "bad\0body"), TypeError);
    await assert.rejects(
      () => store.create(document, "x".repeat(2 * 1024 * 1024 + 1)),
      TypeError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
