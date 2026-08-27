import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { getUsagePlan } from "../tool-registry/registry.ts";

/**
 * AiPy usage is a single SQLite database. The `task` table carries a per-task
 * scratch `workdir` (auto-generated, not a real project), while the `workspace`
 * table (joined via `task.workspace_id`) carries the user's real project
 * directory. Standalone tasks use the short `aipywork/N` task slot plus title
 * so multiple tasks with the same title remain distinct in project details.
 */
async function withFixture<T>(
  fn: (db: DatabaseSync) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "aitracker-aipy-"));
  const db = new DatabaseSync(join(dir, "aipy"), { readOnly: false });
  try {
    db.exec(`
      CREATE TABLE workspace (id TEXT, name TEXT, workdir TEXT);
      CREATE TABLE task (id TEXT, title TEXT, model TEXT, workdir TEXT, workspace_id TEXT);
      CREATE TABLE task_event (task_id TEXT, model TEXT, time INTEGER, usage TEXT);
    `);
    return await fn(db);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("AiPy adapter query prefers workspace workdir and labels standalone tasks", async () => {
  await withFixture(async (db) => {
    db.exec(`
      INSERT INTO workspace (id, name, workdir) VALUES ('ws1', 'Real Project', '/work/real-project');
      INSERT INTO task (id, title, model, workdir, workspace_id) VALUES
        ('t1', 'Workspace task', 'auto', '/work/aipywork/1', 'ws1'),
        ('t2', 'Standalone task', 'auto', '/work/aipywork/2', NULL);
      INSERT INTO task_event (task_id, model, time, usage) VALUES
        ('t1', 'auto', 1787000000000, '{"input_tokens":10,"output_tokens":5,"total_tokens":15}'),
        ('t2', 'auto', 1787000001000, '{"input_tokens":20,"output_tokens":10,"total_tokens":30}');
    `);

    const plan = getUsagePlan("aipy");
    assert.ok(plan, "aipy usage plan missing");
    assert.ok(plan.query, "aipy usage query missing");

    const rows = db.prepare(plan.query).all() as Array<Record<string, unknown>>;
    const bySession = new Map(rows.map((row) => [String(row.sessionId), row]));

    assert.equal(bySession.get("t1")?.project, "/work/real-project");
    assert.equal(bySession.get("t2")?.project, "2 - Standalone task");
  });
});
