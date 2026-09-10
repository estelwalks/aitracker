import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Qoder CN usage support (TokenTracker-sourced): the registry declares a
 * generic-sqlite adapter over the QoderCN `local.db` (…/QoderCN/SharedClientCache/
 * cache/db). One `chat_message` row per assistant completion carries
 * `token_info` JSON (`prompt_tokens` includes `cached_tokens`), `model_info`
 * JSON, and a session join for the project. These tests run the real scan
 * pipeline against sqlite fixtures pinning the cached-input decomposition and
 * row filtering.
 */

const SCHEMA = `
CREATE TABLE chat_message (
  id TEXT,
  session_id TEXT,
  request_id TEXT,
  role TEXT,
  model_info TEXT,
  token_info TEXT,
  gmt_create INTEGER
);
CREATE TABLE chat_record (
  request_id TEXT,
  extra TEXT
);
CREATE TABLE chat_session (
  session_id TEXT,
  project_uri TEXT,
  project_name TEXT,
  preferred_model_info TEXT
);
`;

interface QoderRow {
  id: string;
  sessionId: string;
  requestId?: string;
  role: string;
  modelInfo?: string | null;
  tokenInfo?: string | null;
  gmtCreate: number;
  extra?: string | null;
  projectUri?: string | null;
  projectName?: string | null;
  preferredModelInfo?: string | null;
}

function createQoderDb(path: string, rows: QoderRow[]): void {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insertMessage = db.prepare(
    `INSERT INTO chat_message (id, session_id, request_id, role, model_info,
       token_info, gmt_create)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRecord = db.prepare(
    `INSERT INTO chat_record (request_id, extra) VALUES (?, ?)`,
  );
  const insertSession = db.prepare(
    `INSERT INTO chat_session (session_id, project_uri, project_name,
       preferred_model_info)
     VALUES (?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insertMessage.run(
      row.id,
      row.sessionId,
      row.requestId ?? null,
      row.role,
      row.modelInfo ?? null,
      row.tokenInfo ?? null,
      row.gmtCreate,
    );
    if (row.extra != null) insertRecord.run(row.requestId ?? row.id, row.extra);
    if (row.projectUri != null || row.projectName != null) {
      insertSession.run(
        row.sessionId,
        row.projectUri ?? null,
        row.projectName ?? null,
        row.preferredModelInfo ?? null,
      );
    }
  }
  db.close();
}

test("qoder-cn usage adapter reads chat_message rows with cached-input decomposition", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-qodercn-"));
  try {
    const dbDir = join(
      root,
      "AppData",
      "Roaming",
      "QoderCN",
      "SharedClientCache",
      "cache",
      "db",
    );
    await mkdir(dbDir, { recursive: true });
    const now = Date.parse("2026-09-01T10:00:00.000Z");
    createQoderDb(join(dbDir, "local.db"), [
      {
        id: "assistant-1",
        sessionId: "session-cached-1",
        requestId: "request-1",
        role: "assistant",
        modelInfo: JSON.stringify({ model_key: "quest-ultimate" }),
        tokenInfo: JSON.stringify({
          prompt_tokens: 58299,
          cached_tokens: 57853,
          completion_tokens: 2812,
        }),
        gmtCreate: now,
        extra: null,
        projectUri: "file:///C:/Users/u/code/app",
        projectName: null,
      },
      {
        id: "assistant-2",
        sessionId: "session-fallback-2",
        role: "assistant",
        modelInfo: null,
        tokenInfo: JSON.stringify({
          prompt_tokens: 1000,
          completion_tokens: 250,
        }),
        gmtCreate: now + 60_000,
        extra: null,
        projectUri: null,
        projectName: "blog",
      },
      {
        // Non-assistant rows and empty token_info rows must never be events.
        id: "user-3",
        sessionId: "session-user-3",
        role: "user",
        modelInfo: null,
        tokenInfo: JSON.stringify({
          prompt_tokens: 1,
          completion_tokens: 0,
        }),
        gmtCreate: now + 120_000,
      },
      {
        id: "assistant-4",
        sessionId: "session-empty-4",
        role: "assistant",
        modelInfo: null,
        tokenInfo: "{}",
        gmtCreate: now + 180_000,
      },
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const qoder = snapshot.sources.find(
      (source) => source.source === "qodercn",
    );
    assert.ok(qoder, "qodercn source must be reported");
    assert.equal(qoder.available, true);
    assert.equal(qoder.events, 2);

    const events = snapshot.details.filter(
      (event) => event.source === "qodercn",
    );
    assert.equal(events.length, 2);
    const cached = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("qodercn", "session-cached-1"),
    );
    assert.ok(cached, "cached-input event present");
    assert.equal(cached.model, "quest-ultimate");
    // prompt_tokens includes cached_tokens: only the remainder is fresh input.
    assert.equal(cached.inputTokens, 446);
    assert.equal(cached.cachedInputTokens, 57853);
    assert.equal(cached.outputTokens, 2812);
    assert.equal(cached.reasoningOutputTokens, 0);
    // Components sum back to prompt + completion.
    assert.equal(cached.totalTokens, 61111);
    assert.equal(cached.timestamp, new Date(now).toISOString());
    assert.equal(
      (cached.project ?? "").includes("code/app"),
      true,
      "file:// project uri decoded into the project field",
    );

    const fallback = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("qodercn", "session-fallback-2"),
    );
    assert.ok(fallback);
    assert.equal(fallback.model, "qoder-agent");
    assert.equal(fallback.inputTokens, 1000);
    assert.equal(fallback.totalTokens, 1250);
    assert.equal(fallback.project, "blog");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
