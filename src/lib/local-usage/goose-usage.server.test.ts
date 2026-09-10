import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Goose (Block) usage support (TokenTracker-sourced): the registry declares a
 * generic-sqlite adapter over the Goose `sessions.db` (macOS Application
 * Support / Windows AppData\Roaming /goose/sessions). A row is a session with
 * cumulative token columns; `accumulated_*` wins over single-turn columns,
 * reasoning is the unaccounted excess of `total` over input+output, and the
 * model name lives inside `model_config_json`. These tests run the real scan
 * pipeline against sqlite fixtures pinning that contract.
 */

const SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  model_config_json TEXT,
  provider_name TEXT,
  created_at TEXT NOT NULL,
  total_tokens INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  accumulated_total_tokens INTEGER,
  accumulated_input_tokens INTEGER,
  accumulated_output_tokens INTEGER
);
`;

function createGooseDb(path: string, rows: unknown[][]): void {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO sessions (id, model_config_json, provider_name, created_at,
       total_tokens, input_tokens, output_tokens, accumulated_total_tokens,
       accumulated_input_tokens, accumulated_output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) insert.run(...(row as never[]));
  db.close();
}

test("goose usage adapter reads sessions.db rows with accumulated and reasoning semantics", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-goose-"));
  try {
    const sessionsDir = join(root, "AppData", "Roaming", "goose", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    createGooseDb(join(sessionsDir, "sessions.db"), [
      [
        "sess-cumulative-1",
        '{"model_name":"claude-3-7-sonnet"}',
        "anthropic",
        // Naive UTC format — must be treated as UTC, not the local zone.
        "2026-05-21 14:30:00",
        100, // single-turn values must lose to the accumulated columns
        80,
        20,
        5000,
        4000,
        800,
      ],
      [
        "sess-reasoning-2",
        '{"model_name":"o3-mini"}',
        null,
        "2026-05-21T15:00:00Z",
        120,
        60,
        40,
        // total grew beyond input+output → the excess is reasoning tokens.
        130,
        60,
        30,
      ],
      [
        // Zero-token sessions never become events.
        "sess-zero-3",
        '{"model_name":"claude-3-7-sonnet"}',
        null,
        "2026-05-21T16:00:00Z",
        0,
        0,
        0,
        0,
        0,
        0,
      ],
      [
        // A session whose model config is not usable JSON is skipped.
        "sess-nomodel-4",
        "not-json",
        null,
        "2026-05-21T17:00:00Z",
        500,
        300,
        200,
        500,
        300,
        200,
      ],
      [
        // Unparseable created_at cannot produce a timestamp → skipped.
        "sess-badtime-5",
        '{"model_name":"claude-3-7-sonnet"}',
        null,
        "garbage",
        100,
        60,
        40,
        100,
        60,
        40,
      ],
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const goose = snapshot.sources.find((source) => source.source === "goose");
    assert.ok(goose, "goose source must be reported");
    assert.equal(goose.available, true);
    assert.equal(goose.events, 2);

    const events = snapshot.details.filter((event) => event.source === "goose");
    assert.equal(events.length, 2);
    const cumulative = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("goose", "sess-cumulative-1"),
    );
    assert.ok(cumulative, "cumulative session event present");
    assert.equal(cumulative.model, "claude-3-7-sonnet");
    assert.equal(cumulative.inputTokens, 4000);
    assert.equal(cumulative.outputTokens, 800);
    // 5000 - 4000 - 800 = 200 unaccounted tokens → reasoning.
    assert.equal(cumulative.reasoningOutputTokens, 200);
    assert.equal(cumulative.totalTokens, 5000);
    // Naive UTC "14:30:00" must land on 14:30 UTC (not shifted by the zone).
    assert.equal(cumulative.timestamp, "2026-05-21T14:30:00.000Z");

    const reasoning = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("goose", "sess-reasoning-2"),
    );
    assert.ok(reasoning);
    assert.equal(reasoning.model, "o3-mini");
    assert.equal(reasoning.inputTokens, 60);
    assert.equal(reasoning.outputTokens, 30);
    assert.equal(reasoning.reasoningOutputTokens, 40);
    assert.equal(reasoning.totalTokens, 130);
    assert.equal(reasoning.timestamp, "2026-05-21T15:00:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("goose usage adapter tolerates older schemas without accumulated columns", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-goose-old-"));
  try {
    const sessionsDir = join(root, "AppData", "Roaming", "goose", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const db = new DatabaseSync(join(sessionsDir, "sessions.db"));
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        model_config_json TEXT,
        provider_name TEXT,
        created_at TEXT NOT NULL,
        total_tokens INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
    `);
    db.prepare(
      `INSERT INTO sessions (id, model_config_json, provider_name, created_at,
         total_tokens, input_tokens, output_tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "sess-legacy-1",
      '{"model_name":"gpt-5"}',
      "openai",
      "2026-05-21T18:00:00Z",
      1000,
      700,
      300,
    );
    db.close();

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const goose = snapshot.sources.find((source) => source.source === "goose");
    assert.ok(goose);
    // The adapter queries current-schema columns; legacy DBs without the
    // accumulated_* columns degrade to a query-failed diagnostic instead of
    // fabricating data.
    assert.equal(
      goose.events,
      0,
      "legacy schema without accumulated columns yields no events",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
