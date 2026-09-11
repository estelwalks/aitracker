import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * AnythingLLM Desktop usage support (TokenTracker-sourced): the registry
 * declares a generic-sqlite adapter over the AnythingLLM `storage/anythingllm.db`
 * (anythingllm-desktop under macOS Application Support / Windows AppData\Roaming /
 * Linux XDG config). One `workspace_chats` row per chat carries the usage
 * metrics JSON in `response.metrics` (prompt/completion/total tokens + model).
 * These tests run the real scan pipeline against sqlite fixtures pinning the
 * metric extraction, timestamp normalization and row filtering.
 */

function createAnythingllmDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE workspace_chats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspaceId INTEGER NOT NULL,
      prompt TEXT NOT NULL,
      response TEXT NOT NULL,
      include BOOLEAN DEFAULT true,
      createdAt DATETIME,
      lastUpdatedAt DATETIME
    );
  `);
  return db;
}

test("anythingllm usage adapter reads workspace_chats metrics JSON", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-anythingllm-"));
  try {
    const storageDir = join(
      root,
      "AppData",
      "Roaming",
      "anythingllm-desktop",
      "storage",
    );
    await mkdir(storageDir, { recursive: true });
    const db = createAnythingllmDb(join(storageDir, "anythingllm.db"));
    const insert = db.prepare(
      `INSERT INTO workspace_chats (workspaceId, prompt, response, include, createdAt, lastUpdatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const metrics = (over: Record<string, unknown>) =>
      JSON.stringify({ metrics: { ...over } });
    insert.run(
      1,
      "p1",
      metrics({
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        model: "gpt-5",
      }),
      1,
      // Prisma-style epoch-milliseconds DATETIME.
      Date.parse("2026-09-01T10:00:00.000Z"),
      Date.parse("2026-09-01T10:00:00.000Z"),
    );
    insert.run(
      1,
      "p2",
      // reported total exceeds input+output → the excess is reasoning.
      metrics({
        prompt_tokens: 400,
        completion_tokens: 100,
        total_tokens: 700,
        model: "o3",
      }),
      1,
      "2026-09-01 10:10:00",
      "2026-09-01 10:10:00",
    );
    insert.run(
      2,
      "excluded",
      metrics({
        prompt_tokens: 999,
        completion_tokens: 999,
        total_tokens: 1998,
        model: "gpt-5",
      }),
      0,
      Date.parse("2026-09-01T10:20:00.000Z"),
      Date.parse("2026-09-01T10:20:00.000Z"),
    );
    insert.run(
      2,
      "no-metrics",
      "plain text response without usage metrics",
      1,
      Date.parse("2026-09-01T10:30:00.000Z"),
      Date.parse("2026-09-01T10:30:00.000Z"),
    );
    db.close();

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const source = snapshot.sources.find(
      (entry) => entry.source === "anythingllm",
    );
    assert.ok(source, "anythingllm source must be reported");
    assert.equal(source.available, true);
    assert.equal(source.events, 2);

    const events = snapshot.details.filter(
      (event) => event.source === "anythingllm",
    );
    assert.equal(events.length, 2);
    const first = events.find((event) => event.totalTokens === 1500);
    assert.ok(first, "first chat event present");
    assert.equal(
      first.sessionId,
      sessionIdFromStructuredValue("anythingllm", "1"),
    );
    assert.equal(first.model, "gpt-5");
    assert.equal(first.inputTokens, 1200);
    assert.equal(first.outputTokens, 300);
    assert.equal(first.reasoningOutputTokens, 0);
    assert.equal(first.timestamp, "2026-09-01T10:00:00.000Z");

    const reasoning = events.find((event) => event.totalTokens === 700);
    assert.ok(reasoning);
    assert.equal(reasoning.model, "o3");
    assert.equal(reasoning.inputTokens, 400);
    assert.equal(reasoning.outputTokens, 100);
    assert.equal(reasoning.reasoningOutputTokens, 200);
    // Naive UTC timestamp must not shift into the local zone.
    assert.equal(reasoning.timestamp, "2026-09-01T10:10:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Issue #42 applied to a second generic-sqlite tool: the byte cap was lifted in
 * the one shared generic read path, so AnythingLLM must behave exactly like
 * ZCode on an oversized database. This pins that the fix is structural - a
 * per-tool fix in the ZCode adapter would leave this failing.
 */
test("anythingllm db above maxFileSizeBytes is still queried", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-anythingllm-big-"));
  try {
    const storageDir = join(
      root,
      "AppData",
      "Roaming",
      "anythingllm-desktop",
      "storage",
    );
    await mkdir(storageDir, { recursive: true });
    const databasePath = join(storageDir, "anythingllm.db");
    const db = createAnythingllmDb(databasePath);
    db.prepare(
      `INSERT INTO workspace_chats (workspaceId, prompt, response, include, createdAt, lastUpdatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      1,
      "p1",
      JSON.stringify({
        metrics: {
          prompt_tokens: 1200,
          completion_tokens: 300,
          total_tokens: 1500,
          model: "gpt-5",
        },
      }),
      1,
      Date.parse("2026-09-01T10:00:00.000Z"),
      Date.parse("2026-09-01T10:00:00.000Z"),
    );
    db.close();

    const cap = 536_870_912;
    const handle = await open(databasePath, "r+");
    try {
      await handle.truncate(cap + 8 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const { size } = await stat(databasePath);
    assert.ok(size > cap, "fixture must exceed the adapter byte cap");

    const probe = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const rows = probe
        .prepare("SELECT COUNT(*) AS n FROM workspace_chats")
        .all() as Array<{ n: number }>;
      assert.equal(rows[0]?.n, 1, "padded database must stay queryable");
    } finally {
      probe.close();
    }

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const source = snapshot.sources.find(
      (candidate) => candidate.source === "anythingllm",
    );
    assert.ok(source, "anythingllm source must be reported");
    assert.equal(source.events, 1, "an oversized db must still yield its row");
    assert.deepEqual(
      source.diagnostics ?? [],
      [],
      "file size must not produce a file-too-large diagnostic for sqlite",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
