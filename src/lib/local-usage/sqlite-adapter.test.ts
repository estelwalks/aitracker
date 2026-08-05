import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { APP_DATA_DIR } from "../app-config";

test("scans a configured read-only SQLite usage source", async () => {
  const root = join(tmpdir(), `tt-sqlite-adapter-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const sourceDirectory = join(homeDirectory, ".aipy-test");
  const configDirectory = join(homeDirectory, APP_DATA_DIR);
  const databasePath = join(sourceDirectory, "usage.db");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(configDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE usage_events (
      timestamp INTEGER,
      session_id TEXT,
      model TEXT,
      project TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER
    );
    INSERT INTO usage_events VALUES (
      1785150000000,
      'private-session-id',
      'aipy-test-model',
      '/private/project',
      40,
      8
    );
  `);
  database.close();

  await writeFile(
    join(configDirectory, "usage-adapters.json"),
    JSON.stringify({
      version: 1,
      adapters: [
        {
          id: "aipy-test",
          paths: [{ root: ".aipy-test", glob: "usage.db", format: "sqlite" }],
          query:
            "SELECT timestamp, session_id AS sessionId, model, project, input_tokens AS inputTokens, output_tokens AS outputTokens FROM usage_events",
          mapping: {
            timestamp: ["timestamp"],
            sessionId: ["sessionId"],
            model: ["model"],
            project: ["project"],
            inputTokens: ["inputTokens"],
            outputTokens: ["outputTokens"],
          },
        },
      ],
    }),
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory: join(root, "cache"),
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const event = snapshot.details.find(
      (candidate) => candidate.source === "custom:aipy-test",
    );
    assert.equal(event?.model, "aipy-test-model");
    assert.equal(event?.inputTokens, 40);
    assert.equal(event?.outputTokens, 8);
    assert.equal(event?.totalTokens, 48);
    assert.notEqual(event?.sessionId, "private-session-id");
    assert.notEqual(event?.project, "/private/project");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back to WorkBuddy SQLite usage when detailed JSONL is unavailable", async () => {
  const root = join(
    tmpdir(),
    `tt-workbuddy-sqlite-${process.pid}-${Date.now()}`,
  );
  const homeDirectory = join(root, "home");
  const workbuddyDirectory = join(homeDirectory, ".workbuddy");
  const databasePath = join(workbuddyDirectory, "workbuddy.db");
  await mkdir(workbuddyDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      model TEXT,
      cwd TEXT
    );
    CREATE TABLE session_usage (
      session_id TEXT,
      used INTEGER,
      updated_at INTEGER
    );
    INSERT INTO sessions VALUES ('private-session', 'workbuddy-auto', '/private/project');
    INSERT INTO session_usage VALUES ('private-session', 4321, 1785232800000);
  `);
  database.close();

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory: join(root, "cache"),
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const summary = snapshot.sources.find(
      (source) => source.source === "workbuddy",
    );
    const event = snapshot.details.find(
      (candidate) => candidate.source === "workbuddy",
    );
    assert.equal(summary?.detected, true);
    assert.equal(summary?.available, true);
    assert.equal(event?.model, "workbuddy-auto");
    assert.equal(event?.inputTokens, 4321);
    assert.equal(event?.totalTokens, 4321);
    assert.notEqual(event?.sessionId, "private-session");
    assert.notEqual(event?.project, "/private/project");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auto-detects built-in Aipy without Claude Code or Codex", async () => {
  const root = join(tmpdir(), `tt-aipy-builtin-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const sourceDirectory = join(
    homeDirectory,
    "Library",
    "Application Support",
    "aipy-pro",
  );
  const databasePath = join(sourceDirectory, "aipy");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(join(homeDirectory, ".workbuddy", "projects"), {
    recursive: true,
  });

  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE task (
      id TEXT PRIMARY KEY,
      model TEXT,
      workdir TEXT
    );
    CREATE TABLE task_event (
      time INTEGER,
      task_id TEXT,
      model TEXT,
      usage TEXT
    );
    INSERT INTO task VALUES ('task-1', 'glm-5.2', '/private/aipy-project');
    INSERT INTO task_event VALUES (
      1785232800000,
      'task-1',
      '',
      '{"input_tokens":120,"output_tokens":30,"reasoning_tokens":10,"total_tokens":160}'
    );
  `);
  database.close();

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory: join(root, "cache"),
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const aipy = snapshot.sources.find((source) => source.source === "aipy");
    const workbuddy = snapshot.sources.find(
      (source) => source.source === "workbuddy",
    );

    assert.equal(snapshot.mode, "real");
    assert.equal(aipy?.detected, true);
    assert.equal(aipy?.events, 1);
    const event = snapshot.details.find(
      (candidate) => candidate.source === "aipy",
    );
    assert.equal(event?.totalTokens, 150);
    assert.equal(event?.reasoningOutputTokens, 10);
    assert.equal(workbuddy?.detected, true);
    assert.equal(workbuddy?.available, false);
    assert.ok(
      snapshot.sources.every((source) => source.source !== "custom:aipy"),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
