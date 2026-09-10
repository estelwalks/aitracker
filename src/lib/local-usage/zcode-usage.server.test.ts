import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";

/**
 * ZCode usage support: the registry declares a generic-sqlite adapter reading
 * `model_usage` rows (joined to `session` for the working directory) from
 * `~/.zcode/cli/db/db.sqlite`. ZCode writes the database in WAL mode and its
 * token semantics are DeepSeek-style — `input_tokens` already contains cached
 * input and `output_tokens` already contains reasoning tokens — so the adapter
 * decomposes the classes instead of double counting. These tests run the real
 * scan pipeline against sqlite fixtures to pin the adapter contract.
 */

const SCHEMA = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  directory TEXT
);
CREATE TABLE model_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  model_id TEXT,
  status TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER
);
`;

interface ZcodeUsageRow {
  sessionId: string;
  directory?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cacheCreation?: number;
  cacheRead?: number;
}

function createZcodeDb(
  path: string,
  sessionDirectories: ReadonlyMap<string, string>,
  rows: ZcodeUsageRow[],
  wal = false,
): void {
  const db = new DatabaseSync(path);
  if (wal) db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  const insertSession = db.prepare(
    `INSERT INTO session (id, directory) VALUES (?, ?)`,
  );
  for (const [sessionId, directory] of sessionDirectories) {
    insertSession.run(sessionId, directory);
  }
  const insert = db.prepare(
    `INSERT INTO model_usage (id, session_id, model_id, status, started_at,
       completed_at, input_tokens, output_tokens, reasoning_tokens,
       cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((row, index) => {
    insert.run(
      `usage-${index}`,
      row.sessionId,
      row.model ?? "deepseek-v4-pro",
      row.startedAt,
      row.completedAt ?? row.startedAt + 10_000,
      row.input ?? 0,
      row.output ?? 0,
      row.reasoning ?? 0,
      row.cacheCreation ?? 0,
      row.cacheRead ?? 0,
    );
  });
  db.close();
}

test("zcode usage adapter reads model_usage rows with decomposed tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const projectDir = join(root, "code", "zapp");
    await mkdir(projectDir, { recursive: true });
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    createZcodeDb(
      join(dbDir, "db.sqlite"),
      new Map([["sess-a-1111", projectDir]]),
      [
        {
          sessionId: "sess-a-1111",
          // Provider total = input + output = 31000; cached input (20000) is
          // inside input_tokens and reasoning (200) inside output_tokens.
          startedAt: base,
          completedAt: base + 20_000,
          input: 30000,
          output: 1000,
          reasoning: 200,
          cacheRead: 20000,
          cacheCreation: 0,
        },
        {
          sessionId: "sess-a-1111",
          startedAt: base + 60_000,
          completedAt: base + 70_000,
          input: 4000,
          output: 300,
          reasoning: 50,
          cacheRead: 1000,
          cacheCreation: 0,
        },
        {
          // Zero-token rows must never become events.
          sessionId: "sess-a-1111",
          startedAt: base + 120_000,
          completedAt: base + 130_000,
          input: 0,
          output: 0,
        },
      ],
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(zcode.available, true);
    assert.equal(zcode.filesParsed, 1);
    assert.equal(zcode.events, 2);

    const events = snapshot.details.filter((event) => event.source === "zcode");
    assert.equal(events.length, 2);
    const first = events.find((event) => event.totalTokens === 31000);
    assert.ok(first, "first event present");
    assert.match(first.sessionId ?? "", /^session_[a-f0-9]{20}$/u);
    assert.equal(first.model, "deepseek-v4-pro");
    // Fresh input excludes cached input; output excludes reasoning.
    assert.equal(first.inputTokens, 10000);
    assert.equal(first.cachedInputTokens, 20000);
    assert.equal(first.cacheCreationInputTokens, 0);
    assert.equal(first.outputTokens, 800);
    assert.equal(first.reasoningOutputTokens, 200);
    // Components sum back to the provider total (input + output).
    assert.equal(first.totalTokens, 31000);
    assert.notEqual(first.project, "unknown");
    const second = events.find((event) => event.inputTokens === 3000);
    assert.ok(second);
    assert.equal(second.cachedInputTokens, 1000);
    assert.equal(second.outputTokens, 250);
    assert.equal(second.totalTokens, 4300);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zcode WAL-mode database re-parses when only the -wal file changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-wal-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const databasePath = join(dbDir, "db.sqlite");
    const writer = new DatabaseSync(databasePath);
    writer.exec("PRAGMA journal_mode=WAL");
    writer.exec(SCHEMA);
    const insertSession = writer.prepare(
      `INSERT INTO session (id, directory) VALUES (?, ?)`,
    );
    insertSession.run("sess-wal-1111", join(root, "proj"));
    const insert = writer.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, status, started_at,
         completed_at, input_tokens, output_tokens, reasoning_tokens,
         cache_creation_input_tokens, cache_read_input_tokens)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    const writeRow = (index: number): void => {
      insert.run(
        `usage-wal-${index}`,
        "sess-wal-1111",
        "deepseek-v4-pro",
        base + index * 10_000,
        base + index * 10_000 + 5_000,
        100,
        50,
        10,
        0,
        0,
      );
    };
    writeRow(0);

    const options = {
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
    };
    const first = await scanLocalUsage(options);
    const firstZcode = first.sources.find(
      (source) => source.source === "zcode",
    );
    assert.ok(firstZcode);
    assert.equal(firstZcode.events, 1);

    // Insert a fresh usage row through the still-open writer WITHOUT letting
    // the main database file change (no checkpoint). The scan must notice the
    // changed -wal companion and re-parse instead of serving the cached row.
    writeRow(1);

    const second = await scanLocalUsage(options);
    const secondZcode = second.sources.find(
      (source) => source.source === "zcode",
    );
    assert.ok(secondZcode);
    assert.equal(secondZcode.events, 2, "fresh WAL rows must be collected");
    assert.equal(secondZcode.filesParsed, 1, "file must have been re-parsed");
    assert.equal(
      secondZcode.filesReused,
      0,
      "stale cache entry must not be reused",
    );
    writer.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zcode data-directory override rebases usage roots to the chosen dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-override-"));
  try {
    const dataDir = join(root, "zcode-data");
    await mkdir(join(dataDir, "cli", "db"), { recursive: true });
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    createZcodeDb(join(dataDir, "cli", "db", "db.sqlite"), new Map(), [
      {
        sessionId: "sess-reloc-1111",
        model: "deepseek-v4-pro",
        startedAt: base,
        input: 2000,
        output: 500,
      },
    ]);
    // A stale default ~/.zcode that must be ignored while the override is set.
    await mkdir(join(root, ".zcode", "cli", "db"), { recursive: true });
    createZcodeDb(join(root, ".zcode", "cli", "db", "db.sqlite"), new Map(), [
      {
        sessionId: "sess-stale-2222",
        startedAt: base,
        input: 9999,
        output: 9999,
      },
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      toolDataRoots: new Map([["zcode", dataDir]]),
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(zcode.events, 1, "only override data is scanned");
    const events = snapshot.details.filter((event) => event.source === "zcode");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.inputTokens, 2000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
