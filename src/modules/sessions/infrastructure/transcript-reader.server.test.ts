import { constants, zstdCompressSync } from "node:zlib";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { NodeSqliteDatabase } from "../../../platform/database/infrastructure/node-sqlite-database.server.ts";
import { loadSessionTranscript } from "./transcript-reader.server.ts";

const FIXTURES = join(
  process.cwd(),
  "src/modules/sessions/infrastructure/__fixtures__",
);

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "aitracker-transcript-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** Recursive `{ filePath: content }` snapshot — asserts zero disk side effects. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else {
        snapshot.set(entryPath, await readFile(entryPath, "utf8"));
      }
    }
  }
  if (root.length > 0) await walk(root);
  return snapshot;
}

async function fixture(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

test("Claude Code: extracts user/assistant text, optional thinking; skips system/tool/duplicate/other-session records", async () => {
  await withTempHome(async (home) => {
    const sessionId = "claude-s300-aaaaaaaaaaaaaaaaaaaa";
    const projectDir = join(home, ".claude", "projects", "-Users-demo-proj");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      (await fixture("transcript-claude.jsonl")).replaceAll(
        "__SESSION_ID__",
        sessionId,
      ),
    );

    const transcript = await loadSessionTranscript(
      { source: "claude-code", sessionId },
      { homeDirectory: home },
    );

    assert.equal(transcript.sessionId, sessionId);
    assert.equal(transcript.source, "claude-code");
    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "assistant"],
    );
    assert.equal(transcript.messages[0]?.text, "Fix the login bug");
    assert.equal(transcript.messages[0]?.thinking, undefined);
    // assistant message with a thinking block (deduplicated streamed copy).
    assert.equal(transcript.messages[1]?.text, "I'll look at the auth module.");
    assert.equal(
      transcript.messages[1]?.thinking,
      "Let me check the auth flow first",
    );
    // assistant message with plain-string content, no thinking.
    assert.equal(transcript.messages[2]?.text, "Here is the fix.");
    assert.equal(transcript.messages[2]?.thinking, undefined);
  });
});

test("Codex: extracts message payloads (item/response_item/user_message) and reasoning summaries", async () => {
  await withTempHome(async (home) => {
    const sessionId = "codex-s300-2222-3333-4444-555555555555";
    const sessionDir = join(home, ".codex", "sessions", sessionId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, `rollout-${sessionId}.jsonl`),
      (await fixture("transcript-codex.jsonl")).replaceAll(
        "__SESSION_ID__",
        sessionId,
      ),
    );

    const transcript = await loadSessionTranscript(
      { source: "codex", sessionId },
      { homeDirectory: home },
    );

    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.equal(transcript.messages[0]?.text, "Add a parser");
    assert.equal(transcript.messages[1]?.text, "Let me write a parser.");
    assert.equal(
      transcript.messages[1]?.thinking,
      "First, understand the format.",
    );
    assert.equal(transcript.messages[2]?.text, "Now handle errors");
    assert.equal(transcript.messages[3]?.text, "Done.");
  });
});

test("Grok: extracts user_message/assistant_message content and optional thinking", async () => {
  await withTempHome(async (home) => {
    const sessionId = "grok-s300-2222-3333-4444-555555555555";
    const sessionDir = join(
      home,
      ".grok",
      "sessions",
      "-Users-demo-proj",
      sessionId,
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({ info: { id: sessionId, cwd: "/Users/demo/proj" } }),
    );
    await writeFile(
      join(sessionDir, "updates.jsonl"),
      (await fixture("transcript-grok.jsonl")).replaceAll(
        "__SESSION_ID__",
        sessionId,
      ),
    );

    const transcript = await loadSessionTranscript(
      { source: "grok", sessionId },
      { homeDirectory: home },
    );

    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(transcript.messages[0]?.text, "Explain the architecture");
    assert.equal(
      transcript.messages[1]?.text,
      "The system is split into modules.",
    );
    assert.equal(
      transcript.messages[1]?.thinking,
      "Consider the boundary first",
    );
  });
});

test("AiPy: extracts ordered USER/LLM text and reasoning from its SQLite database", async () => {
  await withTempHome(async (home) => {
    const sessionId = "aipy-s300-aaaaaaaaaa";
    const aipyDir = join(home, "Library", "Application Support", "aipy-pro");
    await mkdir(aipyDir, { recursive: true });
    const databasePath = join(aipyDir, "aipy");
    const database = new NodeSqliteDatabase({ path: databasePath });
    try {
      database.exec(`
        CREATE TABLE task_event (
          task_id TEXT,
          type TEXT,
          content TEXT,
          reason TEXT,
          time INTEGER
        );
      `);
      const insert = database.prepare(
        "INSERT INTO task_event (task_id, type, content, reason, time) VALUES (?, ?, ?, ?, ?)",
      );
      insert.run(sessionId, "LLM", "Second reply", "Consider ordering", 2000);
      insert.run(sessionId, "USER", "First prompt", "ignored", 1000);
      insert.run(sessionId, "TOOL", "tool output", null, 1500);
      insert.run("other-session", "USER", "other prompt", null, 500);
      insert.run(sessionId, "LLM", "Third reply", null, 3000);
    } finally {
      database.close();
    }

    const before = await snapshotTree(home);
    const transcript = await loadSessionTranscript(
      { source: "aipy", sessionId },
      { homeDirectory: home, platform: "darwin" },
    );
    const after = await snapshotTree(home);

    assert.equal(transcript.source, "aipy");
    assert.deepEqual(
      transcript.messages.map((message) => ({
        role: message.role,
        text: message.text,
        thinking: message.thinking,
      })),
      [
        { role: "user", text: "First prompt", thinking: undefined },
        {
          role: "assistant",
          text: "Second reply",
          thinking: "Consider ordering",
        },
        { role: "assistant", text: "Third reply", thinking: undefined },
      ],
    );
    assert.deepEqual(after, before);
  });
});

test("AiPy: reads the full indexed task without database/message/text caps and tolerates older schemas", async () => {
  await withTempHome(async (home) => {
    const sessionId = "aipy-s300-full-aaaaaaaa";
    const aipyDir = join(home, "Library", "Application Support", "aipy-pro");
    await mkdir(aipyDir, { recursive: true });
    const databasePath = join(aipyDir, "aipy");
    const database = new NodeSqliteDatabase({ path: databasePath });
    try {
      // Older AiPy databases may not have the optional `reason` column.
      database.exec(`
        CREATE TABLE task_event (
          task_id TEXT,
          type TEXT,
          content TEXT,
          time INTEGER
        );
      `);
      const insert = database.prepare(
        "INSERT INTO task_event (task_id, type, content, time) VALUES (?, ?, ?, ?)",
      );
      insert.run(sessionId, "llm", "A complete assistant response", 2000);
      insert.run(sessionId, "user", "A complete user prompt", 1000);
    } finally {
      database.close();
    }

    const transcript = await loadSessionTranscript(
      { source: "aipy", sessionId },
      {
        homeDirectory: home,
        platform: "darwin",
        limits: {
          maxFileBytes: 1,
          maxRecordsPerFile: 1,
          maxMessages: 1,
          maxTextLength: 1,
        },
      },
    );

    assert.deepEqual(
      transcript.messages.map((message) => [message.role, message.text]),
      [
        ["user", "A complete user prompt"],
        ["assistant", "A complete assistant response"],
      ],
    );
  });
});

test("returns an empty transcript when no local file matches the session", async () => {
  await withTempHome(async (home) => {
    const transcript = await loadSessionTranscript(
      { source: "claude-code", sessionId: "claude-ghost-aaaaaaaaaaaaaaaaaaaa" },
      { homeDirectory: home },
    );
    assert.deepEqual(transcript.messages, []);
    assert.equal(transcript.sessionId, "claude-ghost-aaaaaaaaaaaaaaaaaaaa");
  });
});

test("returns an empty transcript for an unsafe session id or unknown source", async () => {
  await withTempHome(async (home) => {
    const unsafe = await loadSessionTranscript(
      { source: "claude-code", sessionId: "id; rm -rf /" },
      { homeDirectory: home },
    );
    assert.deepEqual(unsafe.messages, []);

    const unknown = await loadSessionTranscript(
      { source: "not-a-session-tool", sessionId: "abc123" },
      { homeDirectory: home },
    );
    assert.deepEqual(unknown.messages, []);
  });
});

test("skips an oversized file entirely (file-size cap)", async () => {
  await withTempHome(async (home) => {
    const sessionId = "claude-big-aaaaaaaaaaaaaaaaaaaaaa";
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    // One real message, but the file is larger than the (test) cap.
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: "user",
        sessionId,
        message: { role: "user", content: "hello" },
      })}\n`,
    );

    const transcript = await loadSessionTranscript(
      { source: "claude-code", sessionId },
      { homeDirectory: home, limits: { maxFileBytes: 10 } },
    );
    assert.deepEqual(transcript.messages, []);
  });
});

test("stops at the record cap without erroring", async () => {
  await withTempHome(async (home) => {
    const sessionId = "claude-cap-aaaaaaaaaaaaaaaaaaaaaaa";
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const lines = [1, 2, 3].map((index) =>
      JSON.stringify({
        type: "user",
        sessionId,
        message: { role: "user", content: `msg-${index}` },
      }),
    );
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${lines.join("\n")}\n`,
    );

    const transcript = await loadSessionTranscript(
      { source: "claude-code", sessionId },
      { homeDirectory: home, limits: { maxRecordsPerFile: 2 } },
    );
    assert.ok(transcript.messages.length <= 2);
  });
});

// ---------------------------------------------------------------------------
// DeepSeek Harness (DSH) — ~/.dsh/sessions/<workspace>/<session-id>/
// ---------------------------------------------------------------------------

const DSH_TEST_SESSION_ID = "22222222-3333-4444-5555-666666666666";

function dshTranscriptLines(sessionId: string): string {
  const record = (value: unknown) => JSON.stringify(value);
  const lines = [
    {
      type: "session",
      version: 0,
      id: sessionId,
      createdAt: "2026-08-03T09:00:00.000Z",
      cwd: "/Users/demo/proj",
    },
    {
      type: "session/title",
      seq: 1,
      time: "2026-08-03T09:00:00.100Z",
      data: { title: "Fix login" },
    },
    {
      type: "turn/start",
      seq: 2,
      time: "2026-08-03T09:00:00.200Z",
      data: { turn: 1 },
    },
    {
      type: "user/message",
      seq: 3,
      time: 1788333960442,
      data: {
        content: [{ type: "text", text: "修复登录问题" }],
        source: { kind: "user" },
        role: "user",
        id: "user-msg-1",
      },
    },
    {
      type: "assistant/message",
      seq: 4,
      time: 1788333961442,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "先检查 auth 模块" },
            { type: "text", text: "我来修复认证流程。" },
          ],
          source: {
            kind: "model",
            provider: "deepseek-official",
            model: "deepseek-v4-pro",
          },
          id: "asst-msg-1",
        },
        usage: { inputTokens: 100, outputTokens: 20 },
      },
    },
    {
      type: "tool/call",
      seq: 5,
      time: 1788333962442,
      data: {
        turn: 1,
        step: 1,
        callId: "call-1",
        name: "edit",
        arguments: "SECRET ARGS",
      },
    },
    {
      type: "assistant/chunk",
      seq: 6,
      time: 1788333963442,
      data: { messageId: "asst-msg-1", text: "partial" },
    },
    // Retry re-emits the SAME assistant message id with the final text — the
    // reader must keep the last attempt, not the earlier one.
    {
      type: "assistant/message",
      seq: 7,
      time: 1788333964442,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: "assistant",
          content: [
            { type: "reasoning", text: "最终确认 auth 模块" },
            { type: "text", text: "修复完成（重试后的最终结果）" },
          ],
          source: { kind: "model", model: "deepseek-v4-pro" },
          id: "asst-msg-1",
        },
        usage: { inputTokens: 120, outputTokens: 25 },
      },
    },
    {
      type: "user/message",
      seq: 8,
      time: 1788333965442,
      data: {
        content: "再检查一下边界情况",
        source: { kind: "user" },
        role: "user",
        id: "user-msg-2",
      },
    },
  ] as const;
  return `${lines.map((value) => record(value)).join("\n")}\n`;
}

test("DSH: extracts user/assistant text and reasoning from session.jsonl", async () => {
  await withTempHome(async (home) => {
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "aitracker_webapp",
      DSH_TEST_SESSION_ID,
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "session.jsonl"),
      dshTranscriptLines(DSH_TEST_SESSION_ID),
    );

    const transcript = await loadSessionTranscript(
      { source: "dsh", sessionId: DSH_TEST_SESSION_ID },
      { homeDirectory: home },
    );

    assert.equal(transcript.sessionId, DSH_TEST_SESSION_ID);
    assert.equal(transcript.source, "dsh");
    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(transcript.messages[0]?.text, "修复登录问题");
    assert.equal(transcript.messages[0]?.thinking, undefined);
    assert.equal(transcript.messages[1]?.text, "修复完成（重试后的最终结果）");
    assert.equal(transcript.messages[1]?.thinking, "最终确认 auth 模块");
    assert.equal(transcript.messages[2]?.text, "再检查一下边界情况");
  });
});

test("DSH: reads a zstd session log whose directory predates header ids", async () => {
  await withTempHome(async (home) => {
    // Directory uses an opaque uuid; the authoritative id lives in the first
    // frame's session header.
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "legacy-workspace",
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
    await mkdir(sessionDir, { recursive: true });
    const frame = (text: string) =>
      zstdCompressSync(Buffer.from(text, "utf8"), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 },
      });
    const lines = dshTranscriptLines(DSH_TEST_SESSION_ID).split("\n");
    const header = lines[0] ?? "";
    const events = lines.slice(1).join("\n");
    await writeFile(
      join(sessionDir, "session.jsonl.zstd"),
      Buffer.concat([frame(`${header}\n`), frame(events)]),
    );

    const transcript = await loadSessionTranscript(
      { source: "dsh", sessionId: DSH_TEST_SESSION_ID },
      { homeDirectory: home },
    );

    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(transcript.messages[1]?.text, "修复完成（重试后的最终结果）");
    assert.equal(transcript.messages[1]?.thinking, "最终确认 auth 模块");
  });
});

test("DSH: reads a generation-addressed log (session.v3.jsonl.zstd)", async () => {
  await withTempHome(async (home) => {
    // A harness that advanced its stored session format writes the log under a
    // generation-addressed name; the records the transcript reader needs are
    // unchanged.
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "aitracker_webapp",
      DSH_TEST_SESSION_ID,
    );
    await mkdir(sessionDir, { recursive: true });
    const frame = (text: string) =>
      zstdCompressSync(Buffer.from(text, "utf8"), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 },
      });
    const lines = dshTranscriptLines(DSH_TEST_SESSION_ID).split("\n");
    const header = lines[0] ?? "";
    const events = lines.slice(1).join("\n");
    await writeFile(
      join(sessionDir, "session.v3.jsonl.zstd"),
      Buffer.concat([frame(`${header}\n`), frame(events)]),
    );

    const transcript = await loadSessionTranscript(
      { source: "dsh", sessionId: DSH_TEST_SESSION_ID },
      { homeDirectory: home },
    );

    assert.equal(transcript.source, "dsh");
    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(transcript.messages[0]?.text, "修复登录问题");
    assert.equal(transcript.messages[1]?.text, "修复完成（重试后的最终结果）");
  });
});

test("DSH: a migrated session's transcript comes from its highest generation", async () => {
  await withTempHome(async (home) => {
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "aitracker_webapp",
      DSH_TEST_SESSION_ID,
    );
    await mkdir(sessionDir, { recursive: true });
    const frame = (text: string) =>
      zstdCompressSync(Buffer.from(text, "utf8"), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 },
      });
    const container = (jsonl: string) => {
      const lines = jsonl.split("\n");
      return Buffer.concat([
        frame(`${lines[0] ?? ""}\n`),
        frame(lines.slice(1).join("\n")),
      ]);
    };

    // Generation 0: the frozen pre-upgrade log.
    const legacy = dshTranscriptLines(DSH_TEST_SESSION_ID).replace(
      "修复登录问题",
      "迁移前的旧内容",
    );
    await writeFile(join(sessionDir, "session.jsonl.zstd"), container(legacy));
    // Generation 3: the same conversation re-encoded under the new format
    // version. Both files carry the same session header id, so a reader that
    // took the directory at face value would read the session twice and show
    // the superseded text.
    const current = dshTranscriptLines(DSH_TEST_SESSION_ID)
      .replace('"version":0', '"version":3')
      .replace("修复登录问题", "迁移后的最新内容");
    await writeFile(
      join(sessionDir, "session.v3.jsonl.zstd"),
      container(current),
    );

    const transcript = await loadSessionTranscript(
      { source: "dsh", sessionId: DSH_TEST_SESSION_ID },
      { homeDirectory: home },
    );

    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
    assert.equal(transcript.messages.length, 3, "generations are not merged");
    assert.equal(transcript.messages[0]?.text, "迁移后的最新内容");
  });
});

test("reading a transcript produces zero disk side effects", async () => {
  await withTempHome(async (home) => {
    const sessionId = "claude-side-aaaaaaaaaaaaaaaaaaaaaa";
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      (await fixture("transcript-claude.jsonl")).replaceAll(
        "__SESSION_ID__",
        sessionId,
      ),
    );

    const before = await snapshotTree(home);
    const transcript = await loadSessionTranscript(
      { source: "claude-code", sessionId },
      { homeDirectory: home },
    );
    const after = await snapshotTree(home);

    assert.ok(transcript.messages.length > 0);
    assert.deepEqual(after, before);
  });
});

// ---------------------------------------------------------------------------
// Pi (earendil-works/pi coding agent) — ~/.pi/agent/sessions/<--cwd-->/*.jsonl
// ---------------------------------------------------------------------------

const PI_TRANSCRIPT_SESSION_ID = "cccccccc-dddd-eeee-ffff-999999999999";

function piTranscriptFile(
  home: string,
  sessionId: string,
  fileNameId: string,
): string {
  const dir = join(home, ".pi", "agent", "sessions", "--Users-demo-proj--");
  return join(
    dir,
    `${new Date("2026-08-03T09:00:00.000Z").toISOString().replace(/[:.]/g, "-")}_${encodeURIComponent(fileNameId)}.jsonl`,
  );
}

test("Pi: extracts user/assistant text from v4 session logs", async () => {
  await withTempHome(async (home) => {
    const header = {
      v: 4,
      kind: "header",
      id: PI_TRANSCRIPT_SESSION_ID,
      storageVersion: 1,
      createdAt: Date.parse("2026-08-03T09:00:00.000Z"),
      cwd: join(home, "demo-proj"),
    };
    const lines = [
      header,
      {
        type: "message",
        id: "user-1",
        message: {
          role: "user",
          content: [{ type: "text", text: "Fix the bug" }],
          timestamp: Date.parse("2026-08-03T09:00:01.000Z"),
        },
      },
      {
        type: "message",
        id: "asst-1",
        message: {
          role: "assistant",
          model: "deepseek-v4-pro",
          content: [{ type: "text", text: "Looking into it" }],
          timestamp: Date.parse("2026-08-03T09:00:02.000Z"),
        },
      },
      // Duplicate write for the same message id — last write wins.
      {
        type: "message",
        id: "asst-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Fixed now" }],
          timestamp: Date.parse("2026-08-03T09:00:03.000Z"),
        },
      },
      {
        type: "message",
        id: "tool-1",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "ignored" }],
        },
      },
    ];
    const dir = dirname(piTranscriptFile(home, PI_TRANSCRIPT_SESSION_ID, "x"));
    await mkdir(dir, { recursive: true });
    // File name carries the encoded id (matching path).
    await writeFile(
      piTranscriptFile(
        home,
        PI_TRANSCRIPT_SESSION_ID,
        PI_TRANSCRIPT_SESSION_ID,
      ),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );

    const transcript = await loadSessionTranscript(
      { source: "pi", sessionId: PI_TRANSCRIPT_SESSION_ID },
      { homeDirectory: home },
    );
    assert.equal(transcript.sessionId, PI_TRANSCRIPT_SESSION_ID);
    assert.equal(transcript.source, "pi");
    assert.deepEqual(
      transcript.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(transcript.messages[0]?.text, "Fix the bug");
    assert.equal(transcript.messages[1]?.text, "Fixed now");
  });
});

test("Pi: transcript lookup falls back to the storage header id", async () => {
  await withTempHome(async (home) => {
    const header = {
      v: 4,
      kind: "header",
      id: PI_TRANSCRIPT_SESSION_ID,
      storageVersion: 1,
      createdAt: Date.parse("2026-08-03T09:00:00.000Z"),
      cwd: join(home, "demo-proj"),
    };
    const lines = [
      header,
      {
        type: "message",
        id: "user-1",
        message: {
          role: "user",
          content: "Legacy dir question",
          timestamp: Date.parse("2026-08-03T09:00:01.000Z"),
        },
      },
    ];
    const dir = dirname(piTranscriptFile(home, PI_TRANSCRIPT_SESSION_ID, "x"));
    await mkdir(dir, { recursive: true });
    // File name carries a DIFFERENT id than the header.
    await writeFile(
      piTranscriptFile(home, PI_TRANSCRIPT_SESSION_ID, "other-file-id"),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );

    const transcript = await loadSessionTranscript(
      { source: "pi", sessionId: PI_TRANSCRIPT_SESSION_ID },
      { homeDirectory: home },
    );
    assert.equal(transcript.messages.length, 1);
    assert.equal(transcript.messages[0]?.role, "user");
    assert.equal(transcript.messages[0]?.text, "Legacy dir question");
  });
});

// ---------------------------------------------------------------------------
// Hermes Agent — state.db (SQLite) transcripts
// ---------------------------------------------------------------------------

test("Hermes: extracts user/assistant text and reasoning from state.db", async () => {
  await withTempHome(async (home) => {
    const sessionId = "hermes-s300-abc123";
    const hermesDir = join(home, ".hermes");
    await mkdir(hermesDir, { recursive: true });
    const database = new NodeSqliteDatabase({
      path: join(hermesDir, "state.db"),
    });
    try {
      database.exec(`
        CREATE TABLE messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT,
          reasoning_content TEXT,
          reasoning TEXT,
          timestamp REAL
        );
      `);
      const insert = database.prepare(
        `INSERT INTO messages (session_id, role, content, reasoning_content, reasoning, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insert.run(sessionId, "user", "Refactor the module", null, null, 1000.5);
      insert.run(
        sessionId,
        "assistant",
        "",
        "Plan the refactor first",
        "Plan the refactor first",
        2000.5,
      );
      insert.run(sessionId, "assistant", "Done here", null, null, 3000.5);
      insert.run(sessionId, "tool", "tool output", null, null, 2500.5);
      insert.run("other-session", "user", "other prompt", null, null, 500.5);
    } finally {
      database.close();
    }

    const before = await snapshotTree(home);
    const transcript = await loadSessionTranscript(
      { source: "hermes", sessionId },
      { homeDirectory: home },
    );
    const after = await snapshotTree(home);

    assert.equal(transcript.source, "hermes");
    assert.deepEqual(
      transcript.messages.map((message) => ({
        role: message.role,
        text: message.text,
        thinking: message.thinking,
      })),
      [
        { role: "user", text: "Refactor the module", thinking: undefined },
        {
          role: "assistant",
          text: "",
          thinking: "Plan the refactor first",
        },
        { role: "assistant", text: "Done here", thinking: undefined },
      ],
    );
    assert.deepEqual(after, before);
  });
});

// ---------------------------------------------------------------------------
// WorkBuddy — projects JSONL transcripts
// ---------------------------------------------------------------------------

test("WorkBuddy: extracts user/assistant text from the conversation jsonl", async () => {
  await withTempHome(async (home) => {
    const sessionId = "dffe8d5b-2436-4022-b549-d9c227385c19";
    const sessionDirectory = join(home, ".workbuddy", "projects", "demo");
    await mkdir(sessionDirectory, { recursive: true });
    const write = (name: string, lines: object[]) =>
      writeFile(
        join(sessionDirectory, name),
        lines.map((line) => JSON.stringify(line)).join("\n") + "\n",
      );
    await write(`${sessionId}.jsonl`, [
      {
        id: "u-1",
        timestamp: new Date("2026-09-09T04:50:15.000Z").getTime(),
        role: "user",
        content: "Fix the login bug",
        sessionId,
      },
      {
        id: "title-1",
        timestamp: new Date("2026-09-09T04:50:16.000Z").getTime(),
        type: "ai-title",
        aiTitle: "Debug login",
        sessionId,
      },
      {
        id: "resp-1",
        timestamp: new Date("2026-09-09T04:50:17.000Z").getTime(),
        type: "function_call",
        sessionId,
        providerData: { rawUsage: {} },
      },
      {
        id: "a-1",
        timestamp: new Date("2026-09-09T04:50:18.000Z").getTime(),
        role: "assistant",
        content: "I fixed the login flow.",
        sessionId,
      },
      {
        id: "reason-1",
        timestamp: new Date("2026-09-09T04:50:19.000Z").getTime(),
        type: "reasoning",
        content: "hidden reasoning",
        rawContent: "hidden reasoning",
        sessionId,
      },
    ]);
    // A different conversation in the same project folder must stay separate.
    await write("9a8b7c6d-1111-2222-3333-444455556666.jsonl", [
      {
        id: "u-2",
        timestamp: new Date("2026-09-09T05:00:00.000Z").getTime(),
        role: "user",
        content: "Other conversation",
        sessionId: "9a8b7c6d-1111-2222-3333-444455556666",
      },
    ]);

    const before = await snapshotTree(home);
    const transcript = await loadSessionTranscript(
      { source: "workbuddy", sessionId },
      { homeDirectory: home },
    );
    const after = await snapshotTree(home);

    assert.equal(transcript.source, "workbuddy");
    assert.deepEqual(
      transcript.messages.map((message) => ({
        role: message.role,
        text: message.text,
        thinking: message.thinking,
      })),
      [
        { role: "user", text: "Fix the login bug", thinking: undefined },
        {
          role: "assistant",
          text: "I fixed the login flow.",
          thinking: undefined,
        },
      ],
    );
    assert.deepEqual(after, before);
  });
});

test("ZCode: extracts ordered user/assistant text and reasoning from db.sqlite", async () => {
  await withTempHome(async (home) => {
    const sessionId = "sess-zcode-s300-aaaaaaaa";
    const dbDir = join(home, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const databasePath = join(dbDir, "db.sqlite");
    const database = new NodeSqliteDatabase({ path: databasePath });
    try {
      database.exec(`
        CREATE TABLE message (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          data TEXT,
          sequence INTEGER,
          time_created INTEGER
        );
        CREATE TABLE part (
          id TEXT PRIMARY KEY,
          message_id TEXT,
          session_id TEXT,
          data TEXT,
          sequence INTEGER
        );
      `);
      const insertMessage = database.prepare(
        "INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (?, ?, ?, ?, ?)",
      );
      const insertPart = database.prepare(
        "INSERT INTO part (id, message_id, session_id, data, sequence) VALUES (?, ?, ?, ?, ?)",
      );
      const userMsg = (id: string, text: string, atMs: number): void => {
        insertMessage.run(
          id,
          sessionId,
          JSON.stringify({ role: "user", agent: "zcode-agent" }),
          1,
          atMs,
        );
        insertPart.run(
          `${id}-p`,
          id,
          sessionId,
          JSON.stringify({
            type: "text",
            text,
            time: { start: atMs, end: atMs },
          }),
          0,
        );
      };
      const assistantMsg = (
        id: string,
        reasoning: string | null,
        text: string,
        atMs: number,
      ): void => {
        insertMessage.run(
          id,
          sessionId,
          JSON.stringify({ role: "assistant", agent: "zcode-agent" }),
          1,
          atMs,
        );
        let sequence = 0;
        insertPart.run(
          `${id}-step`,
          id,
          sessionId,
          JSON.stringify({ type: "step-start" }),
          sequence++,
        );
        if (reasoning != null) {
          insertPart.run(
            `${id}-reason`,
            id,
            sessionId,
            JSON.stringify({ type: "reasoning", text: reasoning }),
            sequence++,
          );
        }
        insertPart.run(
          `${id}-text`,
          id,
          sessionId,
          JSON.stringify({ type: "text", text }),
          sequence++,
        );
        insertPart.run(
          `${id}-finish`,
          id,
          sessionId,
          JSON.stringify({ type: "step-finish", reason: "stop" }),
          sequence++,
        );
      };
      userMsg("m1", "请修复登录 bug", 1000);
      assistantMsg("m2", "让我先看看代码。", "已修复登录流程。", 2000);
      // A different session must never leak into this transcript.
      insertMessage.run(
        "other-m",
        "other-sess-00000000000000000000000",
        JSON.stringify({ role: "user", agent: "zcode-agent" }),
        1,
        1500,
      );
      insertPart.run(
        "other-p",
        "other-m",
        "other-sess-00000000000000000000000",
        JSON.stringify({ type: "text", text: "其他会话" }),
        0,
      );
      assistantMsg("m3", null, "还需要其他帮助吗？", 3000);
    } finally {
      database.close();
    }

    const before = await snapshotTree(home);
    const transcript = await loadSessionTranscript(
      { source: "zcode", sessionId },
      { homeDirectory: home },
    );
    const after = await snapshotTree(home);

    assert.equal(transcript.source, "zcode");
    assert.deepEqual(
      transcript.messages.map((message) => ({
        role: message.role,
        text: message.text,
        thinking: message.thinking,
      })),
      [
        { role: "user", text: "请修复登录 bug", thinking: undefined },
        {
          role: "assistant",
          text: "已修复登录流程。",
          thinking: "让我先看看代码。",
        },
        { role: "assistant", text: "还需要其他帮助吗？", thinking: undefined },
      ],
    );
    assert.deepEqual(after, before);
  });
});
