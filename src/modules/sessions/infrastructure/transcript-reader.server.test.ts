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
import { join } from "node:path";
import test from "node:test";

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
