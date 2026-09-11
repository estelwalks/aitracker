import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { constants, zstdCompressSync } from "node:zlib";

import { ENV } from "../app-config";
import { normalizeProjectPath } from "../local-usage/project-path.ts";
import { compileToolRegistry } from "../tool-registry/registry.ts";
import {
  __resetSessionReaders,
  registerSessionReader,
} from "../tool-registry/readers/session-readers.ts";
import type { ToolDefinition } from "../tool-registry/contracts.ts";
import { estimateSessionCost } from "./cost.ts";
import { isResumeSafeId } from "./resume-id.ts";
import {
  __resetDshScanCache,
  scanLocalSessions,
  snapshotDshScanCache,
} from "./scanner.server.ts";
import type {
  SessionRecord,
  SessionSource,
  SessionTokenCounts,
} from "./types.ts";

const NOW = new Date("2026-08-03T12:00:00.000Z");

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "aitracker-sessions-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

/** Returns the single session when exactly one is expected, asserting count. */
function soleSession(records: SessionRecord[]): SessionRecord {
  assert.equal(records.length, 1, `expected 1 session, got ${records.length}`);
  return records[0]!;
}

/** SessionRecord must NOT carry any conversation-content fields (privacy). */
const PRIVATE_FIELDS = new Set([
  "prompt",
  "content",
  "message",
  "text",
  "response",
  "output",
  "toolInput",
  "toolOutput",
]);

function assertPrivacyClean(record: SessionRecord): void {
  for (const key of Object.keys(record)) {
    assert.ok(
      !PRIVATE_FIELDS.has(key),
      `SessionRecord leaked content field "${key}"`,
    );
  }
}

test("resume-safe ids: rejects shell metacharacters and command injection", () => {
  assert.equal(isResumeSafeId("abc123"), true);
  assert.equal(isResumeSafeId("11111111-2222-3333-4444-555555555555"), true);
  assert.equal(isResumeSafeId("foo; rm -rf /"), false);
  assert.equal(isResumeSafeId("$(whoami)"), false);
  assert.equal(isResumeSafeId(""), false);
});

test("Claude Code: parses one session with ai-title + usage, excludes journal.jsonl", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(
      home,
      ".claude",
      "projects",
      "-Users-demo-myproject",
    );
    await mkdir(projectDir, { recursive: true });

    const sessionId = "claude-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const sessionFile = join(projectDir, `${sessionId}.jsonl`);
    await writeFile(
      sessionFile,
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          type: "ai-title",
          aiTitle: "Fix login bug",
          sessionId,
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:00:30.000Z",
          sessionId,
          cwd: "/Users/demo/myproject",
          type: "user",
          message: { role: "user", content: "SECRET PROMPT DO NOT LEAK" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:01:00.000Z",
          sessionId,
          cwd: "/Users/demo/myproject",
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-sonnet-4",
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 10,
            },
          },
        }),
      ].join("\n") + "\n",
    );

    // Non-session file: no sessionId-bearing record → must be excluded.
    await writeFile(
      join(projectDir, "journal.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-08-01T09:00:00.000Z",
        type: "journal",
        cwd: "/Users/demo/myproject",
      })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    assert.equal(session.source, "claude-code");
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.title, "Fix login bug");
    assert.equal(session.model, "claude-sonnet-4");
    assert.equal(session.projectKey, "myproject");
    assert.equal(session.projectRef, "/Users/demo/myproject");
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 100);
    assert.equal(session.totals.outputTokens, 50);
    assert.equal(session.totals.cachedInputTokens, 20);
    assert.equal(session.totals.cacheCreationInputTokens, 10);
    assert.equal(session.resumeSafe, true);
    assert.equal(session.resumeCommand, `claude --resume ${sessionId}`);
    assert.equal(session.startedAt, "2026-08-01T09:00:30.000Z");
    assert.equal(session.endedAt, "2026-08-01T09:01:00.000Z");
    assertPrivacyClean(session);
  });
});

test("Claude Code: parses custom-title record (current title format)", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-cccccccc-bbbb-aaaa-dddd-eeeeeeeeeeee";
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:30.000Z",
          sessionId,
          cwd: "/demo",
          type: "user",
          message: { role: "user", content: "SECRET PROMPT DO NOT LEAK" },
        }),
        // An explicit title discovered after the first user message still wins.
        JSON.stringify({
          timestamp: "2026-08-01T09:00:45.000Z",
          type: "custom-title",
          customTitle: "Refactor auth module",
          sessionId,
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:01:00.000Z",
          sessionId,
          cwd: "/demo",
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-sonnet-4",
            usage: { input_tokens: 10 },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    assert.equal(session.title, "Refactor auth module");
    assert.equal(session.source, "claude-code");
    assertPrivacyClean(session);
  });
});

test("Claude Code: derives a safe title from the first valid user text block", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "fallback-title");
    const repo = join(home, "work", "real-repository");
    const nestedCwd = join(repo, "packages", "web");
    await mkdir(projectDir, { recursive: true });
    await mkdir(join(repo, ".git"), { recursive: true });
    await mkdir(nestedCwd, { recursive: true });
    const sessionId = "claude-fallback-title-aaaaaaaaaaaaaaaa";
    const rawPath = join(home, "private", "credentials.txt");
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T08:59:00.000Z",
          sessionId,
          cwd: nestedCwd,
          type: "user",
          isMeta: true,
          message: { role: "user", content: "injected system command" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T08:59:30.000Z",
          sessionId,
          cwd: nestedCwd,
          type: "user",
          message: {
            role: "user",
            content: [{ type: "tool_result", content: "tool output" }],
          },
        }),
        JSON.stringify({
          sessionId,
          cwd: nestedCwd,
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: `## Please fix <b>login</b> at ${rawPath} token=abc123`,
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:00:30.000Z",
          sessionId,
          cwd: nestedCwd,
          type: "user",
          message: { role: "user", content: "SHOULD NOT REPLACE FIRST TEXT" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:01:00.000Z",
          sessionId,
          cwd: nestedCwd,
          type: "assistant",
          message: { role: "assistant", model: "claude-sonnet-4" },
        }),
      ].join("\n") + "\n",
    );

    const session = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(session.title, "Please fix login at [path] [sensitive]");
    assert.ok(!session.title.includes(rawPath));
    assert.ok(!session.title.includes("abc123"));
    assert.equal(session.projectKey, "real-repository");
    assert.equal(session.projectRef, normalizeProjectPath(repo, home));
    assert.equal(session.resumeCwd, nestedCwd);
    assertPrivacyClean(session);
  });
});

test("session projects aggregate at a valid gitdir root and retain non-git cwd fallback", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "git-projects");
    const gitMetadata = join(home, "git-metadata", "worktrees", "feature");
    const checkout = join(home, "checkouts", "feature");
    const nestedOne = join(checkout, "apps", "one");
    const nestedTwo = join(checkout, "packages", "two");
    const noGitRoot = join(home, "scratch", "plain-root");
    const noGit = join(noGitRoot, "nested", "plain-folder");
    await mkdir(projectDir, { recursive: true });
    await mkdir(gitMetadata, { recursive: true });
    await mkdir(nestedOne, { recursive: true });
    await mkdir(nestedTwo, { recursive: true });
    await mkdir(noGit, { recursive: true });
    await writeFile(join(checkout, ".git"), `gitdir: ${gitMetadata}\n`);

    const sessions = [
      ["claude-git-one-aaaaaaaaaaaaaaaa", nestedOne],
      ["claude-git-two-bbbbbbbbbbbbbbbb", nestedTwo],
      ["claude-no-git-cccccccccccccccc", noGit],
    ] as const;
    for (const [sessionId, cwd] of sessions) {
      await writeFile(
        join(projectDir, `${sessionId}.jsonl`),
        `${JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          sessionId,
          cwd,
          type: "assistant",
          message: { role: "assistant", model: "claude-sonnet-4" },
        })}\n`,
      );
    }

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const byId = new Map(
      summary.sessions.map((session) => [session.sessionId, session]),
    );
    for (const sessionId of [sessions[0][0], sessions[1][0]]) {
      assert.equal(byId.get(sessionId)?.projectKey, "feature");
      assert.equal(
        byId.get(sessionId)?.projectRef,
        normalizeProjectPath(checkout, home),
      );
    }
    assert.equal(byId.get(sessions[0][0])?.resumeCwd, nestedOne);
    assert.equal(byId.get(sessions[1][0])?.resumeCwd, nestedTwo);
    assert.equal(byId.get(sessions[2][0])?.projectKey, "plain-folder");
    assert.equal(
      byId.get(sessions[2][0])?.projectRef,
      normalizeProjectPath(noGit, home),
    );

    // A negative lookup must not be permanent: users commonly run `git init`
    // after the first scan while the desktop app remains open.
    await mkdir(join(noGitRoot, ".git"), { recursive: true });
    const rescanned = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
    });
    const initialized = rescanned.sessions.find(
      (session) => session.sessionId === sessions[2][0],
    );
    assert.equal(initialized?.projectKey, "plain-root");
    assert.equal(
      initialized?.projectRef,
      normalizeProjectPath(noGitRoot, home),
    );
  });
});

test("Claude Code: skips <synthetic> / <unknown> placeholder models", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-synthetic-test-aaaaaaaaaaaaaaaa";
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "<synthetic>",
            usage: { input_tokens: 5 },
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:01:00.000Z",
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-opus-4",
            usage: { input_tokens: 5 },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.model, "claude-opus-4");
  });
});

test("Claude Code: merges two files that share a sessionId", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-merge-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    // First fragment: earlier in time, smaller usage.
    await writeFile(
      join(projectDir, "part1.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-a",
            usage: { input_tokens: 30, output_tokens: 10 },
          },
        }),
      ].join("\n") + "\n",
    );
    // Second fragment (e.g. subagent sidechain): later, additional usage.
    await writeFile(
      join(projectDir, "part2.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:30:00.000Z",
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-b",
            usage: { input_tokens: 70, output_tokens: 20 },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    // Tokens summed across both fragments.
    assert.equal(session.totals.inputTokens, 100);
    assert.equal(session.totals.outputTokens, 30);
    // Span covers earliest → latest.
    assert.equal(session.startedAt, "2026-08-01T09:00:00.000Z");
    assert.equal(session.endedAt, "2026-08-01T09:30:00.000Z");
    assert.equal(session.turns, 2);
  });
});

test("Codex: resolves title from session_index.jsonl, model from turn_context, cwd", async () => {
  await withTempHome(async (home) => {
    const codexDir = join(home, ".codex");
    const sessionId = "codex1111-2222-3333-4444-555555555555";
    await mkdir(join(codexDir, "sessions", "2026", "08", "01"), {
      recursive: true,
    });
    const rolloutPath = join(
      codexDir,
      "sessions",
      "2026",
      "08",
      "01",
      `rollout-${sessionId}.jsonl`,
    );
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-08-01T10:00:00.000Z",
          type: "session_meta",
          payload: {
            type: "session_meta",
            id: sessionId,
            cwd: "/Users/demo/codex-proj",
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:05.000Z",
          type: "turn_context",
          payload: {
            type: "turn_context",
            model: "gpt-5-codex",
            model_provider: "OpenAI", // must NOT be picked as the model
            cwd: "/Users/demo/codex-proj",
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:10.000Z",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 200, // raw input INCLUDES cached
                cached_input_tokens: 50,
                output_tokens: 40,
                reasoning_output_tokens: 15,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    await writeFile(
      join(codexDir, "session_index.jsonl"),
      `${JSON.stringify({ id: sessionId, thread_name: "Refactor parser" })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    assert.equal(session.source, "codex");
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.title, "Refactor parser");
    assert.equal(session.model, "gpt-5-codex");
    assert.equal(session.projectKey, "codex-proj");
    assert.equal(session.projectRef, "/Users/demo/codex-proj");
    // Codex raw input includes cached → display input subtracts cache_read.
    assert.equal(session.totals.inputTokens, 150);
    assert.equal(session.totals.cachedInputTokens, 50);
    assert.equal(session.totals.outputTokens, 40);
    assert.equal(session.totals.reasoningOutputTokens, 15);
    assert.equal(session.resumeCommand, `codex resume ${sessionId}`);
    assertPrivacyClean(session);
  });
});

test("Codex: parses current payload envelopes and counts explicit patch events once", async () => {
  await withTempHome(async (home) => {
    const sessionId = "codex2222-2222-3333-4444-555555555555";
    const sessionDir = join(home, ".codex", "sessions", "2026", "08", "01");
    await mkdir(sessionDir, { recursive: true });
    const fixture = await readFile(
      join(
        process.cwd(),
        "src/lib/local-sessions/__fixtures__/codex-current-envelope.jsonl",
      ),
      "utf8",
    );
    await writeFile(
      join(sessionDir, `rollout-${sessionId}.jsonl`),
      fixture.replaceAll("__SESSION_ID__", sessionId),
    );

    const session = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.title, "Review the current envelope parser");
    assert.equal(session.model, "gpt-5-codex");
    assert.equal(session.projectRef, "/Users/demo/codex-current");
    assert.equal(session.editTurns, 1);
    assert.equal(session.totals.inputTokens, 150);
    assert.equal(session.totals.cachedInputTokens, 50);
    assert.equal(session.totals.outputTokens, 40);
    assert.equal(session.totals.reasoningOutputTokens, 15);
    // reasoning is a subcategory of output, not an additional token bucket.
    assert.equal(session.totals.totalTokens, 240);
    assertPrivacyClean(session);
  });
});

test("Codex: synthetic env/plugin preamble is skipped as a fallback title", async () => {
  await withTempHome(async (home) => {
    const codexDir = join(home, ".codex");
    const sessionId = "codex3333-2222-3333-4444-555555555555";
    const sessionDir = join(codexDir, "sessions", "2026", "08", "01");
    await mkdir(sessionDir, { recursive: true });
    // First "user" turn is the injected <environment_context> preamble — it
    // must NOT become the title; the real prompt below must.
    await writeFile(
      join(sessionDir, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T10:00:00.000Z",
          type: "session_meta",
          payload: { id: sessionId, cwd: "/Users/demo/codex-proj" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:01.000Z",
          type: "turn_context",
          payload: { model: "gpt-5-codex", cwd: "/Users/demo/codex-proj" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "response_item",
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "<environment_context>",
                  "<cwd>/Users/demo/codex-proj</cwd>",
                  "<shell>zsh</shell>",
                  "<current_date>2026-08-01</current_date>",
                  "<timezone>Asia/Shanghai</timezone>",
                  "</environment_context>",
                ].join("\n"),
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:03.000Z",
          type: "response_item",
          payload: {
            type: "response_item",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "重构登录流程并补充单测",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:04.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 200,
                cached_input_tokens: 50,
                output_tokens: 40,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    const session = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(session.title, "重构登录流程并补充单测");
    assert.doesNotMatch(
      session.title,
      /environment_context|Asia\/Shanghai|cwd|codex-proj/,
    );
    assertPrivacyClean(session);
  });
});

test("Codex: guardian subagent threads are skipped as user sessions", async () => {
  await withTempHome(async (home) => {
    const codexDir = join(home, ".codex");
    const sessionId = "codex4444-2222-3333-4444-555555555555";
    const sessionDir = join(codexDir, "sessions", "2026", "08", "01");
    await mkdir(sessionDir, { recursive: true });
    // Auto-spawned guardian/approval-review thread: thread_source is
    // "subagent" and its first "user" turn is injected AGENTS.md + env
    // preamble. It must never surface as a user session.
    await writeFile(
      join(sessionDir, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T10:00:00.000Z",
          type: "session_meta",
          payload: {
            id: sessionId,
            cwd: "/Users/demo/codex-proj",
            thread_source: "subagent",
            source: { subagent: { other: "guardian" } },
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:01.000Z",
          type: "turn_context",
          payload: { model: "gpt-5-codex", cwd: "/Users/demo/codex-proj" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "response_item",
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "# AGENTS.md instructions for /Users/demo/codex-proj",
                  "",
                  "<INSTRUCTIONS>",
                  "> [!IMPORTANT]",
                  "> This project is connected to [Lovable](https://lovable.dev).",
                  "</INSTRUCTIONS>",
                  "",
                  "<environment_context>",
                  "<cwd>/Users/demo/codex-proj</cwd>",
                  "</environment_context>",
                ].join("\n"),
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:03.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 200,
                cached_input_tokens: 50,
                output_tokens: 40,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(summary.sessions.length, 0);
  });
});

test("Codex: AGENTS.md instruction block is skipped as a fallback title", async () => {
  await withTempHome(async (home) => {
    const codexDir = join(home, ".codex");
    const sessionId = "codex5555-2222-3333-4444-555555555555";
    const sessionDir = join(codexDir, "sessions", "2026", "08", "01");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, `rollout-${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T10:00:00.000Z",
          type: "session_meta",
          payload: { id: sessionId, cwd: "/Users/demo/codex-proj" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:02.000Z",
          type: "response_item",
          payload: {
            type: "response_item",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "# AGENTS.md instructions for /Users/demo/codex-proj\n\n<INSTRUCTIONS>\n> This project is connected to [Lovable](https://lovable.dev).\n</INSTRUCTIONS>\n",
              },
              {
                type: "input_text",
                text: "修复会话标题展示错误",
              },
            ],
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T10:00:04.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 200,
                cached_input_tokens: 50,
                output_tokens: 40,
              },
            },
          },
        }),
      ].join("\n") + "\n",
    );

    const session = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(session.title, "修复会话标题展示错误");
    assert.doesNotMatch(session.title, /AGENTS\.md|INSTRUCTIONS|Lovable/);
    assertPrivacyClean(session);
  });
});

test("Claude Code: deduplicates streamed usage and turns by session and message id", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "duplicate-project");
    await mkdir(projectDir, { recursive: true });
    const fixture = await readFile(
      join(
        process.cwd(),
        "src/lib/local-sessions/__fixtures__/claude-duplicate-message.jsonl",
      ),
      "utf8",
    );
    await writeFile(join(projectDir, "duplicate.jsonl"), fixture);

    const session = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 100);
    assert.equal(session.totals.cachedInputTokens, 20);
    assert.equal(session.totals.cacheCreationInputTokens, 10);
    assert.equal(session.totals.outputTokens, 40);
    assert.equal(session.totals.reasoningOutputTokens, 8);
    assert.equal(session.totals.totalTokens, 170);
    assertPrivacyClean(session);
  });
});

test("Grok: title precedence generated_title over session_summary, id from summary.info.id", async () => {
  await withTempHome(async (home) => {
    const sessionId = "grokaaaa-2222-3333-4444-555555555555";
    const sessionDir = join(
      home,
      ".grok",
      "sessions",
      "-Users-demo-grokproj",
      sessionId,
    );
    await mkdir(sessionDir, { recursive: true });

    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        generated_title: "Build dashboard",
        session_summary: "should not win when generated_title present",
        current_model_id: "grok-4-fallback",
        info: { id: sessionId, cwd: "/Users/demo/grokproj" },
      }),
    );

    await writeFile(
      join(sessionDir, "updates.jsonl"),
      [
        JSON.stringify({
          timestamp: 1785581940,
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "tool_call", title: "Apply patch" },
            _meta: {
              eventId: "tool-current-1",
              agentTimestampMs: 1785581940000,
              "x.ai/tool": { name: "apply_patch" },
            },
          },
        }),
        JSON.stringify({
          timestamp: 1785581970,
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "tool_call", title: "Spawn subagent" },
            _meta: {
              eventId: "tool-current-2",
              agentTimestampMs: 1785581970000,
              "x.ai/tool": { name: "spawn_subagent" },
            },
          },
        }),
        JSON.stringify({
          timestamp: 1785582000,
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "turn_completed",
              usage: {
                modelUsage: {
                  "grok-4": {
                    inputTokens: 80,
                    outputTokens: 30,
                    cachedReadTokens: 10,
                    reasoningTokens: 7,
                    totalTokens: 110,
                  },
                },
              },
            },
            _meta: {
              eventId: "turn-current-1",
              agentTimestampMs: 1785582000000,
              totalTokens: 999999,
            },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    assert.equal(session.source, "grok");
    assert.equal(session.sessionId, sessionId);
    assert.equal(session.title, "Build dashboard");
    assert.equal(session.model, "grok-4");
    assert.equal(session.projectKey, "grokproj");
    assert.equal(session.totals.inputTokens, 70);
    assert.equal(session.totals.cachedInputTokens, 10);
    assert.equal(session.totals.outputTokens, 30);
    assert.equal(session.totals.reasoningOutputTokens, 7);
    assert.equal(session.totals.totalTokens, 110);
    assert.equal(session.editTurns, 1);
    assert.equal(session.subagentCalls, 1);
    assert.equal(session.resumeCommand, `grok --resume ${sessionId}`);
    assertPrivacyClean(session);
  });
});

test("Grok: falls back to session_summary title when generated_title absent", async () => {
  await withTempHome(async (home) => {
    const sessionId = "grokbbbb-2222-3333-4444-555555555555";
    const sessionDir = join(home, ".grok", "sessions", "demo", sessionId);
    await mkdir(sessionDir, { recursive: true });

    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        session_summary: "fallback summary title",
        info: { id: sessionId, cwd: "/demo" },
      }),
    );
    await writeFile(
      join(sessionDir, "updates.jsonl"),
      `${JSON.stringify({
        type: "turn_completed",
        timestamp: "2026-08-01T11:00:00.000Z",
        usage: { modelUsage: [{ inputTokens: 5, outputTokens: 5 }] },
      })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.title, "fallback summary title");
    assert.equal(session.projectKey, "demo");
  });
});

test("Grok: falls back to directory name when summary.info.id is missing", async () => {
  await withTempHome(async (home) => {
    const dirName = "grokdirid-2222-3333-4444-555555555555";
    const sessionDir = join(home, ".grok", "sessions", "demo", dirName);
    await mkdir(sessionDir, { recursive: true });
    // No summary.json at all.
    await writeFile(
      join(sessionDir, "updates.jsonl"),
      `${JSON.stringify({
        type: "turn_completed",
        timestamp: "2026-08-01T11:00:00.000Z",
        usage: { modelUsage: [{ inputTokens: 1 }] },
      })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.sessionId, dirName);
    assert.equal(session.resumeCommand, `grok --resume ${dirName}`);
  });
});

test("resumeSafe is false and resumeCommand null for a malicious id", async () => {
  await withTempHome(async (home) => {
    // Hand-craft a Grok session whose directory name carries shell injection.
    // (We avoid `/` since it cannot appear in a real directory name.)
    const maliciousId = "foo; rm -rf $HOME";
    const sessionDir = join(home, ".grok", "sessions", "demo", maliciousId);
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "updates.jsonl"),
      `${JSON.stringify({
        type: "turn_completed",
        timestamp: "2026-08-01T11:00:00.000Z",
        usage: { modelUsage: [{ inputTokens: 1 }] },
      })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.sessionId, maliciousId);
    assert.equal(session.resumeSafe, false);
    assert.equal(session.resumeCommand, null);
  });
});

test("只使用明确的本地元数据标记异常中断或丢失，不从缺失记录猜测", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const interruptedId = "claude-interrupted-aaaaaaaaaaaaaaaa";
    const ordinaryId = "claude-ordinary-bbbbbbbbbbbbbbbbbbbb";
    const lostId = "claude-lost-cccccccccccccccccccccccc";

    await writeFile(
      join(projectDir, `${interruptedId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-01T09:00:00.000Z",
        sessionId: interruptedId,
        status: "cancelled",
      })}\n`,
    );
    // A timestamp-only record is incomplete metadata, not proof of failure.
    await writeFile(
      join(projectDir, `${ordinaryId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-01T10:00:00.000Z",
        sessionId: ordinaryId,
      })}\n`,
    );
    await writeFile(
      join(projectDir, `${lostId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-01T11:00:00.000Z",
        sessionId: lostId,
        state: "session_lost",
      })}\n`,
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const byId = new Map(
      summary.sessions.map((session) => [session.sessionId, session]),
    );

    assert.equal(byId.get(interruptedId)?.status, "interrupted");
    assert.match(byId.get(interruptedId)?.statusReason ?? "", /明确标记/);
    assert.equal(byId.get(lostId)?.status, "lost");
    assert.match(byId.get(lostId)?.statusReason ?? "", /明确标记/);
    assert.equal(byId.get(ordinaryId)?.status, "available");
    assert.equal(byId.get(ordinaryId)?.statusReason, null);
  });
});

test("durationMs uses ACTIVE time — ignores an idle gap > 30 min", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-active-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    // Two bursts separated by a 2-hour idle gap. Active time should be
    // the 1-minute intra-burst gap (60_000ms) × 2 bursts = 120_000ms,
    // NOT the ~2h wall-clock span.
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-a",
            usage: { input_tokens: 1 },
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:01:00.000Z", // +60s within burst 1
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-a",
            usage: { input_tokens: 1 },
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T11:01:00.000Z", // +2h idle gap (excluded)
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-a",
            usage: { input_tokens: 1 },
          },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T11:02:00.000Z", // +60s within burst 2
          sessionId,
          cwd: "/demo",
          message: {
            role: "assistant",
            model: "claude-a",
            usage: { input_tokens: 1 },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    // Active = 60s + 60s = 120_000ms; wall-clock would be ~7320s.
    assert.equal(session.durationMs, 120_000);
  });
});

test("returns an empty summary when no session directories exist", async () => {
  await withTempHome(async (home) => {
    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(summary.total, 0);
    assert.deepEqual(summary.sessions, []);
    assert.equal(typeof summary.generatedAt, "string");
  });
});

test("dedupes by source:sessionId across sources and sorts by startedAt desc", async () => {
  await withTempHome(async (home) => {
    // One claude session and one codex session, sharing NO id — both kept,
    // ordered by startedAt descending regardless of source.
    const claudeProject = join(home, ".claude", "projects", "demo");
    await mkdir(claudeProject, { recursive: true });
    const claudeId = "claude-sorted-aaaaaaaaaaaaaaaaaaaa";
    await writeFile(
      join(claudeProject, `${claudeId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-02T09:00:00.000Z",
        sessionId: claudeId,
        cwd: "/demo",
        message: { role: "assistant", model: "m", usage: { input_tokens: 1 } },
      })}\n`,
    );

    const codexDir = join(home, ".codex");
    const codexId = "codexsort-2222-3333-4444-555555555555";
    await mkdir(join(codexDir, "sessions", "2026", "08", "01"), {
      recursive: true,
    });
    await writeFile(
      join(
        codexDir,
        "sessions",
        "2026",
        "08",
        "01",
        `rollout-${codexId}.jsonl`,
      ),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          type: "session_meta",
          payload: { type: "session_meta", id: codexId, cwd: "/demo" },
        }),
        JSON.stringify({
          timestamp: "2026-08-01T09:00:10.000Z",
          payload: {
            type: "token_count",
            info: { total_token_usage: { input_tokens: 1 } },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(summary.total, 2);
    assert.equal(summary.sessions[0]!.sessionId, claudeId);
    assert.equal(summary.sessions[1]!.sessionId, codexId);
    // Confirm basename helper for projectKey works for both sources.
    assert.equal(summary.sessions[0]!.projectKey, "demo");
    // Sanity: basename import path is exercised.
    assert.equal(basename("/x/y"), "y");
  });
});

test("Claude Code: respects the usage-home env override", async () => {
  await withTempHome(async (home) => {
    const projectDir = join(home, ".claude", "projects", "demo");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-env-aaaaaaaaaaaaaaaaaaaaaa";
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        timestamp: "2026-08-01T09:00:00.000Z",
        sessionId,
        cwd: "/demo",
        message: { role: "assistant", model: "m", usage: { input_tokens: 1 } },
      })}\n`,
    );

    const previous = process.env[ENV.USAGE_HOME];
    process.env[ENV.USAGE_HOME] = home;
    try {
      const summary = await scanLocalSessions({ now: NOW });
      assert.equal(summary.total, 1);
      assert.equal(summary.sessions[0]!.sessionId, sessionId);
    } finally {
      if (previous === undefined) {
        delete process.env[ENV.USAGE_HOME];
      } else {
        process.env[ENV.USAGE_HOME] = previous;
      }
    }
  });
});

test("P1-3: a newly registered session reader is scanned via the registry plan", async () => {
  await withTempHome(async (home) => {
    const toolId = "fake-session-tool";
    const readerKey = "fake-session-v1";
    const sessionId = "fake-session-0001";

    // Fixture consumed by the fake reader (its own mini metadata format).
    await mkdir(join(home, ".fake", "sessions"), { recursive: true });
    await writeFile(
      join(home, ".fake", "sessions", `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          id: sessionId,
          cwd: "/work/fake",
          model: "fake-model-1",
          inputTokens: 10,
          outputTokens: 5,
        }),
      ].join("\n") + "\n",
    );

    // A session tool that exists only in a custom registry: adding one must
    // require nothing but a tool definition + a controlled reader registration.
    const fakeTool: ToolDefinition = {
      id: toolId,
      configVersion: 1,
      display: { name: "Fake Session Tool", nameZh: "Fake Session Tool" },
      detection: { roots: [".fake"] },
      storage: { dataRoots: [{ base: "home", path: ".fake" }] },
      capabilities: {
        usage: { mode: "unsupported" },
        skills: { mode: "unsupported" },
        agents: { mode: "unsupported" },
        sessions: {
          mode: "resume",
          reader: readerKey,
          command: ["fake", "resume", "{sessionId}"],
        },
        market: { mode: "unsupported" },
        security: { mode: "unsupported" },
      },
    };
    const registry = compileToolRegistry([fakeTool]);

    const scannedRoots: string[] = [];
    let observedSignal: AbortSignal | undefined;
    registerSessionReader({
      key: readerKey,
      scan: async (root, signal) => {
        scannedRoots.push(root);
        observedSignal = signal;
        // Mini parser: one JSON metadata record per line (privacy-safe).
        const raw = await readFile(
          join(root, "sessions", `${sessionId}.jsonl`),
          "utf8",
        );
        const records: SessionRecord[] = [];
        for (const line of raw.split("\n")) {
          if (line.length === 0) continue;
          const value = JSON.parse(line) as Record<string, unknown>;
          const id = typeof value.id === "string" ? value.id : "";
          if (id === "") continue;
          const inputTokens = Number(value.inputTokens) || 0;
          const outputTokens = Number(value.outputTokens) || 0;
          const startedAt = String(value.timestamp ?? "");
          const totals: SessionTokenCounts = {
            inputTokens,
            outputTokens,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: inputTokens + outputTokens,
          };
          const base: Omit<SessionRecord, "cost"> = {
            sessionId: id,
            source: toolId as SessionSource,
            title: "",
            projectKey: "fake",
            projectRef: String(value.cwd ?? ""),
            model: typeof value.model === "string" ? value.model : null,
            startedAt,
            endedAt: startedAt,
            durationMs: 0,
            turns: 1,
            editTurns: 0,
            retryTurns: 0,
            totals,
            subagentCalls: 0,
            status: "available",
            statusReason: null,
            resumeSafe: isResumeSafeId(id),
            resumeCommand: null,
          };
          records.push({ ...base, cost: estimateSessionCost(base) });
        }
        return records;
      },
      defaultRoots: [],
    });

    try {
      const controller = new AbortController();
      const summary = await scanLocalSessions({
        homeDirectory: home,
        now: NOW,
        registry,
        signal: controller.signal,
        platform: "win32",
      });
      // The scan root came from the platform path plan (storage.dataRoots +
      // home base), not from a hardcoded suffix.
      assert.deepEqual(scannedRoots, [join(home, ".fake")]);
      assert.equal(observedSignal, controller.signal);
      const session = soleSession(summary.sessions);
      assert.equal(session.source, toolId);
      assert.equal(session.sessionId, sessionId);
      assert.equal(session.model, "fake-model-1");
      assert.equal(session.totals.inputTokens, 10);
      assert.equal(session.totals.outputTokens, 5);
      assertPrivacyClean(session);
    } finally {
      __resetSessionReaders();
    }
  });
});

// ---------------------------------------------------------------------------
// DeepSeek Harness (DSH) — ~/.dsh/sessions/<workspace>/<session-id>/session.jsonl[.zstd]
// ---------------------------------------------------------------------------

const DSH_SESSION_ID = "11111111-2222-3333-4444-555555555555";

/** Privacy-safe DSH session records (content strings are never extracted). */
function dshRecords(cwd: string): object[] {
  return [
    {
      type: "session",
      version: 0,
      id: DSH_SESSION_ID,
      createdAt: "2026-08-03T09:00:00.000Z",
      cwd,
      delegationDepth: 0,
      agentPreset: "cordis",
    },
    {
      type: "session/title",
      seq: 1,
      time: "2026-08-03T09:00:00.100Z",
      data: { title: "Refactor scanner", source: "user" },
    },
    {
      type: "request/context",
      seq: 2,
      time: "2026-08-03T09:00:00.200Z",
      data: {
        provider: "deepseek-official",
        model: "deepseek-v4-flash",
        contextWindow: 1000000,
      },
    },
    {
      type: "turn/start",
      seq: 3,
      time: "2026-08-03T09:00:00.300Z",
      data: { turn: 1 },
    },
    {
      type: "assistant/message",
      seq: 4,
      time: "2026-08-03T09:00:01.000Z",
      data: {
        turn: 1,
        step: 1,
        message: { role: "assistant", content: "SECRET MESSAGE" },
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 50,
          reasoningTokens: 5,
        },
      },
    },
    {
      type: "tool/call",
      seq: 5,
      time: "2026-08-03T09:00:01.500Z",
      data: {
        turn: 1,
        step: 1,
        callId: "call-1",
        name: "edit",
        arguments: "SECRET ARGS",
      },
    },
    {
      type: "assistant/message",
      seq: 6,
      time: "2026-08-03T09:00:02.000Z",
      data: {
        turn: 1,
        step: 2,
        message: { role: "assistant", content: "SECRET MESSAGE" },
        usage: { inputTokens: 40, outputTokens: 3, cacheReadTokens: 0 },
      },
    },
    {
      type: "tool/call",
      seq: 7,
      time: "2026-08-03T09:00:02.500Z",
      data: {
        turn: 1,
        step: 2,
        callId: "call-2",
        name: "subagent",
        arguments: "SECRET ARGS",
      },
    },
  ];
}

function dshJsonl(cwd: string): string {
  return `${dshRecords(cwd)
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
}

test("DSH: parses session.jsonl (compression none) with turns/project/tools", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "aitracker_webapp");
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "aitracker_webapp",
      DSH_SESSION_ID,
    );
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "session.jsonl"), dshJsonl(cwd));

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    assert.equal(session.source, "dsh");
    assert.equal(session.sessionId, DSH_SESSION_ID);
    assert.equal(session.title, "Refactor scanner");
    assert.equal(session.model, "deepseek-v4-flash");
    assert.equal(session.projectKey, "aitracker_webapp");
    assert.equal(session.projectRef, "~/aitracker_webapp");
    assert.equal(session.turns, 1);
    assert.equal(session.editTurns, 1);
    assert.equal(session.subagentCalls, 1);
    assert.equal(session.totals.inputTokens, 140);
    assert.equal(session.totals.cachedInputTokens, 50);
    assert.equal(session.totals.outputTokens, 23);
    assert.equal(session.totals.reasoningOutputTokens, 5);
    assert.equal(session.totals.totalTokens, 218);
    assert.equal(session.resumeSafe, true);
    assert.equal(
      session.resumeCommand,
      `dsh --profile tui --resume ${DSH_SESSION_ID}`,
    );
    assert.equal(session.startedAt, "2026-08-03T09:00:00.000Z");
    assertPrivacyClean(session);
  });
});

test("DSH: decodes a zstd session log through the shared dsh-zstd reader", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "project-z");
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "project-z",
      DSH_SESSION_ID,
    );
    await mkdir(sessionDir, { recursive: true });
    const frame = (text: string) =>
      zstdCompressSync(Buffer.from(text, "utf8"), {
        params: { [constants.ZSTD_c_checksumFlag]: 1 },
      });
    const [header, ...events] = dshRecords(cwd);
    await writeFile(
      join(sessionDir, "session.jsonl.zstd"),
      Buffer.concat([
        frame(`${JSON.stringify(header)}\n`),
        frame(`${events.map((record) => JSON.stringify(record)).join("\n")}\n`),
      ]),
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "dsh");
    assert.equal(session.sessionId, DSH_SESSION_ID);
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 140);
    assert.equal(session.resumeSafe, true);
    assertPrivacyClean(session);
  });
});

test("DSH: session summary counts all sessions across workspaces", async () => {
  await withTempHome(async (home) => {
    const secondSessionId = "66666666-7777-8888-9999-aaaaaaaaaaaa";
    for (const [workspace, sessionId] of [
      ["project-a", DSH_SESSION_ID],
      ["project-b", secondSessionId],
    ] as const) {
      const sessionDir = join(home, ".dsh", "sessions", workspace, sessionId);
      await mkdir(sessionDir, { recursive: true });
      const records = dshRecords(join(home, workspace));
      records[0] = { ...records[0], id: sessionId };
      await writeFile(
        join(sessionDir, "session.jsonl"),
        `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      );
    }

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(summary.total, 2);
    assert.deepEqual(
      summary.sessions.map((session) => session.source),
      ["dsh", "dsh"],
    );
    assert.deepEqual(
      new Set(summary.sessions.map((session) => session.projectKey)),
      new Set(["project-a", "project-b"]),
    );
  });
});

/** One zstd frame from plaintext (checksummed like the DSH writer). */
function dshFrame(text: string): Buffer {
  return zstdCompressSync(Buffer.from(text, "utf8"), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  });
}

function dshSessionFile(home: string, workspace: string): string {
  return join(
    home,
    ".dsh",
    "sessions",
    workspace,
    DSH_SESSION_ID,
    "session.jsonl.zstd",
  );
}

test("DSH: appended frames are picked up incrementally without losing totals", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "project-append");
    const file = dshSessionFile(home, "project-append");
    await mkdir(dirname(file), { recursive: true });
    const [header, ...events] = dshRecords(cwd);
    await writeFile(
      file,
      Buffer.concat([
        dshFrame(`${JSON.stringify(header)}\n`),
        dshFrame(
          `${events.map((record) => JSON.stringify(record)).join("\n")}\n`,
        ),
      ]),
    );

    const firstScan = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
    });
    const first = soleSession(firstScan.sessions);
    assert.equal(first.turns, 1);
    assert.equal(first.totals.totalTokens, 218);

    // The DSH writer appends new frames for new events; the second scan must
    // merge them into the cached metadata (no full re-decode).
    const extra = [
      {
        type: "turn/start",
        seq: 100,
        time: "2026-08-03T09:01:00.000Z",
        data: { turn: 2 },
      },
      {
        type: "assistant/message",
        seq: 101,
        time: "2026-08-03T09:01:01.000Z",
        data: {
          turn: 2,
          step: 1,
          message: { role: "assistant", content: "SECRET MESSAGE" },
          usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 0 },
        },
      },
      {
        type: "tool/call",
        seq: 102,
        time: "2026-08-03T09:01:02.000Z",
        data: {
          turn: 2,
          step: 1,
          callId: "call-3",
          name: "subagent",
          arguments: "SECRET ARGS",
        },
      },
    ] as const;
    const appended = await readFile(file);
    // Ensure the file stamp advances past the first write's millisecond.
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(
      file,
      Buffer.concat([
        appended,
        dshFrame(
          `${extra.map((record) => JSON.stringify(record)).join("\n")}\n`,
        ),
      ]),
    );

    const secondScan = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
    });
    const second = soleSession(secondScan.sessions);
    assert.equal(second.sessionId, DSH_SESSION_ID);
    assert.equal(second.turns, 2);
    assert.equal(second.totals.inputTokens, 150);
    assert.equal(second.totals.cachedInputTokens, 50);
    assert.equal(second.totals.outputTokens, 27);
    assert.equal(second.totals.totalTokens, 232);
    assert.equal(second.subagentCalls, 2);
    assert.equal(second.editTurns, 1);

    // An unchanged file must replay from the cache with identical results.
    const thirdScan = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
    });
    const third = soleSession(thirdScan.sessions);
    assert.deepEqual(
      { turns: third.turns, totals: third.totals, editTurns: third.editTurns },
      {
        turns: second.turns,
        totals: second.totals,
        editTurns: second.editTurns,
      },
    );
    assertPrivacyClean(third);
  });
});

test("DSH: rewritten logs are re-parsed instead of served stale from cache", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "project-rewrite");
    const file = dshSessionFile(home, "project-rewrite");
    await mkdir(dirname(file), { recursive: true });
    const records = dshRecords(cwd);
    await writeFile(
      file,
      Buffer.concat([
        dshFrame(
          `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
        ),
      ]),
    );

    const first = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(first.totals.inputTokens, 140);
    assert.equal(first.subagentCalls, 1);

    // Rewrite the log IN PLACE with the same total byte length (100 -> 111):
    // a size-identical rewrite must not fool the append-only cache guard.
    const rewritten = structuredClone(records) as Array<
      Record<string, unknown>
    >;
    const firstAssistant = rewritten[4] as {
      data: { usage: { inputTokens: number } };
    };
    firstAssistant.data.usage.inputTokens = 111;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await writeFile(
      file,
      Buffer.concat([
        dshFrame(
          `${rewritten.map((record) => JSON.stringify(record)).join("\n")}\n`,
        ),
      ]),
    );

    const second = soleSession(
      (await scanLocalSessions({ homeDirectory: home, now: NOW })).sessions,
    );
    assert.equal(second.totals.inputTokens, 151);
    assert.equal(second.totals.outputTokens, 23);
    assert.equal(second.totals.totalTokens, 229);
    assert.equal(second.turns, 1);
    assert.equal(second.editTurns, 1);
    assert.equal(second.subagentCalls, 1);
    assertPrivacyClean(second);
  });
});

test("DSH: persisted scan cache hydrates a fresh process without re-decoding", async () => {
  await withTempHome(async (home) => {
    const secondSessionId = "99999999-aaaa-bbbb-cccc-dddddddddddd";
    const files: string[] = [];
    for (const [workspace, sessionId] of [
      ["project-a", DSH_SESSION_ID],
      ["project-b", secondSessionId],
    ] as const) {
      const file = dshSessionFile(home, workspace);
      await mkdir(dirname(file), { recursive: true });
      const records = dshRecords(join(home, workspace));
      const recordsForId =
        sessionId === DSH_SESSION_ID
          ? records
          : [{ ...records[0]!, id: sessionId }, ...records.slice(1)];
      await writeFile(
        file,
        `${recordsForId.map((record) => JSON.stringify(record)).join("\n")}\n`,
      );
      files.push(file);
    }

    const first = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(first.total, 2);

    // Simulate a process restart: snapshot the cache, drop it from memory,
    // delete one session log, and scan again with only the persisted state.
    const snapshot = snapshotDshScanCache();
    assert.ok(snapshot != null);
    __resetDshScanCache();
    await rm(files[0]!, { force: true });

    const second = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
      dshCacheState: snapshot,
    });
    assert.equal(second.total, 1);
    const survivor = soleSession(second.sessions);
    assert.equal(survivor.sessionId, secondSessionId);
    assert.equal(survivor.turns, 1);
    assert.equal(survivor.totals.inputTokens, 140);
    assert.equal(survivor.totals.totalTokens, 218);
    assertPrivacyClean(survivor);

    // The hydrated root is pruned of vanished files and still snapshots.
    const resnapshot = snapshotDshScanCache();
    assert.ok(resnapshot != null);
    assert.equal(
      Object.values(resnapshot.roots).reduce(
        (sum, entries) => sum + Object.keys(entries).length,
        0,
      ),
      1,
    );
  });
});

test("DSH: corrupt persisted cache state is ignored safely", async () => {
  await withTempHome(async (home) => {
    const file = dshSessionFile(home, "project-c");
    await mkdir(dirname(file), { recursive: true });
    const records = dshRecords(join(home, "project-c"));
    await writeFile(
      file,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );

    const summary = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
      dshCacheState: { version: 99, garbage: [1, 2] },
    });
    assert.equal(summary.total, 1);
    const session = soleSession(summary.sessions);
    assert.equal(session.totals.inputTokens, 140);
  });
});

test("session projectRef normalizes identically to usage event projects", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "acme");
    // Use Claude Code's layout (simplest) to exercise the shared normalization
    // applied by scanLocalSessions to every scanned session record.
    const projectDir = join(home, ".claude", "projects", "-demo-acme");
    await mkdir(projectDir, { recursive: true });
    const sessionId = "claude-cccccccc-cccc-cccc-cccc-cccccccccccc";
    await writeFile(
      join(projectDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          timestamp: "2026-08-01T09:00:00.000Z",
          sessionId,
          cwd,
          type: "assistant",
          message: {
            role: "assistant",
            model: "claude-sonnet-4",
            usage: { input_tokens: 10, output_tokens: 5 },
          },
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);

    // The scanner normalizes HOME-relative cwd exactly like the usage scanner
    // normalizes event.project, so both collapse to the same project key.
    assert.equal(session.projectRef, normalizeProjectPath(cwd, home));
    assert.equal(session.projectRef, "~/acme");
    assert.equal(session.projectKey, "acme");
  });
});

test("session project identity uses the same Git-root canonicalization as usage", async () => {
  await withTempHome(async (home) => {
    const repositoryRoot = join(home, "Documents", "Dev", "repo");
    const releaseDirectory = join(repositoryRoot, "release");
    const componentDirectory = join(repositoryRoot, "src", "components");
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(releaseDirectory, { recursive: true });
    await mkdir(componentDirectory, { recursive: true });

    const session = (sessionId: string, cwd: string) =>
      JSON.stringify({
        timestamp: "2026-08-01T09:00:00.000Z",
        sessionId,
        cwd,
        type: "assistant",
        message: {
          role: "assistant",
          model: "claude-sonnet-4",
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      });
    const projectDir = join(home, ".claude", "projects", "-repo");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "release.jsonl"),
      `${session("claude-release", releaseDirectory)}\n`,
    );
    await writeFile(
      join(projectDir, "components.jsonl"),
      `${session("claude-components", "~/Documents/Dev/repo/src/components")}\n`,
    );

    // Pin a platform without a macOS TCC gate: darwin deliberately skips the
    // disk probe for `~/Documents/…`, so this cross-platform collapse contract
    // would otherwise pass on Linux CI and fail on a macOS developer machine.
    const summary = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
      platform: "linux",
    });
    assert.equal(summary.total, 2);
    assert.deepEqual(
      new Set(summary.sessions.map((record) => record.projectRef)),
      new Set(["~/Documents/Dev/repo"]),
    );
    assert.ok(summary.sessions.every((record) => record.isGitProject === true));
  });
});

test("AiPy: starts a session at its first USER message, not an earlier lifecycle event", async () => {
  await withTempHome(async (home) => {
    const aipyDirectory = join(
      home,
      "Library",
      "Application Support",
      "aipy-pro",
    );
    await mkdir(aipyDirectory, { recursive: true });
    const database = new DatabaseSync(join(aipyDirectory, "aipy"));
    try {
      database.exec(`
        CREATE TABLE workspace (id TEXT, workdir TEXT);
        CREATE TABLE task (
          id TEXT,
          title TEXT,
          model TEXT,
          workdir TEXT,
          workspace_id TEXT
        );
        CREATE TABLE task_event (
          task_id TEXT,
          model TEXT,
          type TEXT,
          usage TEXT,
          time INTEGER
        );
      `);
      database
        .prepare(
          "INSERT INTO task (id, title, model, workdir, workspace_id) VALUES (?, ?, ?, ?, ?)",
        )
        .run("aipy-delayed-start", "Delayed start", "gpt-test", "/tmp", null);
      const insertEvent = database.prepare(
        "INSERT INTO task_event (task_id, model, type, usage, time) VALUES (?, ?, ?, ?, ?)",
      );
      insertEvent.run(
        "aipy-delayed-start",
        "gpt-test",
        "STATE",
        "{}",
        Date.parse("2026-08-01T09:00:00.000Z"),
      );
      insertEvent.run(
        "aipy-delayed-start",
        "gpt-test",
        "STDIN",
        "{}",
        Date.parse("2026-08-01T09:00:00.001Z"),
      );
      insertEvent.run(
        "aipy-delayed-start",
        "gpt-test",
        "USER",
        "{}",
        Date.parse("2026-08-05T10:00:00.000Z"),
      );
      insertEvent.run(
        "aipy-delayed-start",
        "gpt-test",
        "LLM",
        '{"input_tokens":10,"output_tokens":5,"total_tokens":15}',
        Date.parse("2026-08-05T10:00:02.000Z"),
      );
    } finally {
      database.close();
    }

    const session = soleSession(
      (
        await scanLocalSessions({
          homeDirectory: home,
          now: NOW,
          // The fixture lays out AiPy's macOS app-data path; AiPy's platform
          // plan has no Linux roots, so pin the simulated platform.
          platform: "darwin",
        })
      ).sessions,
    );
    assert.equal(session.source, "aipy");
    assert.equal(session.startedAt, "2026-08-05T10:00:00.000Z");
    assert.equal(session.endedAt, "2026-08-05T10:00:02.000Z");
    assert.equal(session.totals.totalTokens, 15);
    assertPrivacyClean(session);
  });
});

// ---------------------------------------------------------------------------
// Pi (earendil-works/pi coding agent) — ~/.pi/agent/sessions/<--cwd-->/*.jsonl
// ---------------------------------------------------------------------------

const PI_SESSION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PI_TIME = new Date("2026-08-03T09:00:00.000Z").getTime();

function piV4Header(cwd: string): string {
  return JSON.stringify({
    v: 4,
    kind: "header",
    id: PI_SESSION_ID,
    storageVersion: 1,
    createdAt: PI_TIME,
    cwd,
  });
}

function piV3Header(cwd: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: PI_SESSION_ID,
    timestamp: "2026-08-03T09:00:00.000Z",
    cwd,
  });
}

async function writePiSession(
  home: string,
  workspace: string,
  header: string,
  lines: string[],
): Promise<string> {
  const dir = join(home, ".pi", "agent", "sessions", `--Users-${workspace}--`);
  await mkdir(dir, { recursive: true });
  const file = join(
    dir,
    `${new Date(PI_TIME).toISOString().replace(/[:.]/g, "-")}_${encodeURIComponent(PI_SESSION_ID)}.jsonl`,
  );
  await writeFile(file, [header, ...lines].join("\n"));
  return file;
}

test("Pi: v4 session logs become read-only session records with token totals", async () => {
  await withTempHome(async (home) => {
    const workspace = "pi-proj-a";
    const cwd = join(home, workspace);
    await writePiSession(home, workspace, piV4Header(cwd), [
      JSON.stringify({
        type: "message",
        id: "user-1",
        message: {
          role: "user",
          content: [{ type: "text", text: "Fix login please" }],
          timestamp: PI_TIME + 1000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "asst-1",
        message: {
          role: "assistant",
          model: "deepseek-v4-flash",
          timestamp: PI_TIME + 2000,
          content: [{ type: "text", text: "SECRET ANSWER" }],
          usage: {
            input: 100,
            output: 20,
            cacheRead: 50,
            reasoningTokens: 5,
          },
        },
      }),
    ]);

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "pi");
    assert.equal(session.sessionId, PI_SESSION_ID);
    assert.equal(session.projectKey, workspace);
    assert.equal(session.projectRef, `~/pi-proj-a`);
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 100);
    assert.equal(session.totals.cachedInputTokens, 50);
    assert.equal(session.totals.outputTokens, 20);
    assert.equal(session.totals.reasoningOutputTokens, 5);
    assert.equal(session.totals.totalTokens, 175);
    assert.equal(session.model, "deepseek-v4-flash");
    assert.equal(session.title, "Fix login please");
    assert.equal(session.startedAt, "2026-08-03T09:00:00.000Z");
    // pi has no resume CLI surface here: sessions are read-only.
    assert.equal(session.resumeSafe, false);
    assert.equal(session.resumeCommand, null);
    assert.equal(session.status, "available");
    assertPrivacyClean(session);
  });
});

test("Pi: legacy v3 session headers are recognized", async () => {
  await withTempHome(async (home) => {
    const workspace = "pi-proj-v3";
    const cwd = join(home, workspace);
    await writePiSession(home, workspace, piV3Header(cwd), [
      JSON.stringify({
        type: "message",
        id: "user-1",
        message: {
          role: "user",
          content: "Resume please",
          timestamp: PI_TIME + 1000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "asst-1",
        message: {
          role: "assistant",
          model: "claude-3-7-sonnet",
          timestamp: PI_TIME + 2000,
          content: [],
          usage: { input: 7, output: 2 },
        },
      }),
    ]);

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "pi");
    assert.equal(session.sessionId, PI_SESSION_ID);
    assert.equal(session.turns, 1);
    assert.equal(session.totals.totalTokens, 9);
    assert.equal(session.model, "claude-3-7-sonnet");
    assert.equal(session.title, "Resume please");
    assert.equal(session.resumeSafe, false);
    assertPrivacyClean(session);
  });
});

test("Omp: main-agent sessions are listed under ~/.omp; nested subagents are not", async () => {
  await withTempHome(async (home) => {
    const cwd = join(home, "omp-proj");
    const mainDir = join(home, ".omp", "agent", "sessions", "--omp-proj--");
    await mkdir(mainDir, { recursive: true });
    const mainFile = join(
      mainDir,
      `${new Date(PI_TIME).toISOString().replace(/[:.]/g, "-")}_${encodeURIComponent(PI_SESSION_ID)}.jsonl`,
    );
    await writeFile(
      mainFile,
      [
        piV4Header(cwd),
        JSON.stringify({
          type: "message",
          id: "user-1",
          message: {
            role: "user",
            content: [{ type: "text", text: "Analyze this repo" }],
            timestamp: PI_TIME + 1000,
          },
        }),
        JSON.stringify({
          type: "message",
          id: "asst-1",
          message: {
            role: "assistant",
            model: "deepseek-v4-pro",
            timestamp: PI_TIME + 2000,
            content: [],
            usage: { input: 60, output: 12 },
          },
        }),
      ].join("\n"),
    );
    // Nested subagent transcript below the cwd level must NOT become a session.
    const subDir = join(mainDir, "task-1");
    await mkdir(subDir, { recursive: true });
    await writeFile(
      join(subDir, "agent.jsonl"),
      [
        piV4Header(cwd),
        JSON.stringify({
          type: "message",
          id: "sub-1",
          message: {
            role: "assistant",
            timestamp: PI_TIME + 3000,
            content: [],
            usage: { input: 30, output: 6 },
          },
        }),
      ].join("\n"),
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "omp");
    assert.equal(session.sessionId, PI_SESSION_ID);
    assert.equal(session.projectKey, "omp-proj");
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 60);
    assert.equal(session.totals.totalTokens, 72);
    assert.equal(session.model, "deepseek-v4-pro");
    assert.equal(session.title, "Analyze this repo");
    assert.equal(session.resumeSafe, false);
    assertPrivacyClean(session);
  });
});

// ---------------------------------------------------------------------------
// Hermes Agent session reader — state.db (SQLite) default + profiles layouts.
// ---------------------------------------------------------------------------

const HERMES_EPOCH = Math.floor(
  new Date("2026-09-09T00:00:00.000Z").getTime() / 1000,
);

function createHermesSessionDb(
  databasePath: string,
  rows: Array<{
    id: string;
    model?: string | null;
    title?: string | null;
    displayName?: string | null;
    startedAt: number;
    endedAt?: number | null;
    lastActivityAt?: number | null;
    cwd?: string | null;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    users?: number;
    firstUserContent?: string | null;
    firstUserAtMs?: number;
    lastMessageAtMs?: number;
  }>,
): void {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, model TEXT, title TEXT, display_name TEXT,
      started_at REAL, ended_at REAL, last_activity_at REAL, cwd TEXT,
      input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      role TEXT NOT NULL, content TEXT, timestamp REAL
    );
  `);
  const insertSession = db.prepare(
    `INSERT INTO sessions (
       id, model, title, display_name, started_at, ended_at, last_activity_at,
       cwd, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       reasoning_tokens
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insertSession.run(
      row.id,
      row.model ?? null,
      row.title ?? null,
      row.displayName ?? null,
      row.startedAt,
      row.endedAt ?? null,
      row.lastActivityAt ?? null,
      row.cwd ?? null,
      row.inputTokens ?? 0,
      row.outputTokens ?? 0,
      row.cacheReadTokens ?? 0,
      row.cacheWriteTokens ?? 0,
      row.reasoningTokens ?? 0,
    );
    for (let index = 0; index < (row.users ?? 0); index += 1) {
      const atMs =
        row.firstUserAtMs != null
          ? row.firstUserAtMs + index * 60_000
          : (row.startedAt + 60 + index * 60) * 1000;
      insertMessage.run(
        row.id,
        "user",
        index === 0 && row.firstUserContent != null
          ? row.firstUserContent
          : `extra prompt ${index}`,
        atMs / 1000,
      );
    }
    if (row.lastMessageAtMs != null) {
      insertMessage.run(row.id, "assistant", "ok", row.lastMessageAtMs / 1000);
    }
  }
  db.close();
}

test("Hermes: reads sessions from default + profile state.db", async () => {
  await withTempHome(async (home) => {
    const hermesDir = join(home, ".hermes");
    await mkdir(join(hermesDir, "profiles", "work"), { recursive: true });
    const projectDir = join(home, "hermes-project");
    await mkdir(projectDir, { recursive: true });
    createHermesSessionDb(join(hermesDir, "state.db"), [
      {
        id: "hermes_done",
        model: "deepseek-v4-flash",
        // Hermes stores REAL epoch seconds with sub-millisecond precision;
        // timestamps must round to whole milliseconds for INTEGER projections.
        startedAt: HERMES_EPOCH - 7200 + 0.123456,
        endedAt: HERMES_EPOCH - 3600 + 0.654321,
        lastActivityAt: HERMES_EPOCH - 3700 + 0.5,
        cwd: projectDir,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 200,
        cacheWriteTokens: 50,
        reasoningTokens: 100,
        users: 2,
        firstUserContent: "Build the login flow",
        firstUserAtMs: (HERMES_EPOCH - 7150) * 1000 + 0.25,
        lastMessageAtMs: (HERMES_EPOCH - 3650) * 1000 + 0.75,
      },
      {
        id: "hermes_active",
        model: "deepseek-r1",
        startedAt: HERMES_EPOCH - 600 + 0.987654,
        endedAt: null,
        lastActivityAt: HERMES_EPOCH - 60 + 0.4,
        cwd: projectDir,
        inputTokens: 800,
        outputTokens: 300,
        users: 1,
        firstUserContent: "Continue the refactor",
        firstUserAtMs: (HERMES_EPOCH - 550) * 1000 + 0.1,
        lastMessageAtMs: (HERMES_EPOCH - 80) * 1000 + 0.9,
      },
    ]);
    createHermesSessionDb(join(hermesDir, "profiles", "work", "state.db"), [
      {
        id: "hermes_profile_1",
        model: "claude-sonnet-4-5",
        startedAt: HERMES_EPOCH - 86400 * 3,
        endedAt: HERMES_EPOCH - 86400 * 3 + 900,
        cwd: projectDir,
        inputTokens: 2000,
        outputTokens: 1000,
        cacheReadTokens: 500,
        cacheWriteTokens: 100,
        reasoningTokens: 200,
        users: 1,
        firstUserContent: "Profile session prompt",
      },
    ]);

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const hermes = summary.sessions.filter(
      (record) => record.source === "hermes",
    );
    assert.equal(hermes.length, 3);
    const byId = new Map(hermes.map((record) => [record.sessionId, record]));
    const done = byId.get("hermes_done");
    assert.ok(done);
    assert.equal(done.title, "Build the login flow");
    assert.equal(done.model, "deepseek-v4-flash");
    assert.equal(done.projectKey, "hermes-project");
    assert.equal(done.projectRef, "~/hermes-project");
    assert.equal(done.turns, 2);
    assert.equal(done.totals.inputTokens, 1000);
    assert.equal(done.totals.outputTokens, 500);
    assert.equal(done.totals.cachedInputTokens, 200);
    assert.equal(done.totals.cacheCreationInputTokens, 50);
    assert.equal(done.totals.reasoningOutputTokens, 100);
    assert.equal(done.totals.totalTokens, 1850);
    assert.equal(done.resumeSafe, false);
    assert.equal(done.resumeCommand, null);
    assertPrivacyClean(done);

    const active = byId.get("hermes_active");
    assert.ok(active, "in-flight sessions (ended_at NULL) must be listed");
    assert.equal(active.totals.totalTokens, 1100);
    assert.equal(active.title, "Continue the refactor");

    const profile = byId.get("hermes_profile_1");
    assert.ok(profile, "profiles/<name>/state.db must be discovered");
    assert.equal(profile.model, "claude-sonnet-4-5");
    assert.equal(profile.totals.totalTokens, 3800);
    for (const record of hermes) {
      // Sub-millisecond REAL epochs must round to whole milliseconds so the
      // INTEGER session projection (STRICT SQLite) accepts the records.
      assert.equal(Number.isInteger(record.durationMs), true, record.sessionId);
      assert.match(
        record.startedAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
        record.sessionId,
      );
      assert.match(
        record.endedAt,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
        record.sessionId,
      );
      assertPrivacyClean(record);
    }
  });
});

test("Hermes: Windows default install lives under AppData/Local/hermes", async () => {
  await withTempHome(async (home) => {
    const localHermes = join(home, "AppData", "Local", "hermes");
    await mkdir(localHermes, { recursive: true });
    const projectDir = join(home, "win-project");
    await mkdir(projectDir, { recursive: true });
    createHermesSessionDb(join(localHermes, "state.db"), [
      {
        id: "win_hermes_1",
        model: "deepseek-v4-flash",
        startedAt: HERMES_EPOCH - 3600,
        endedAt: HERMES_EPOCH - 1800,
        cwd: projectDir,
        inputTokens: 300,
        outputTokens: 100,
        users: 1,
        firstUserContent: "Windows session prompt",
      },
    ]);

    const summary = await scanLocalSessions({
      homeDirectory: home,
      now: NOW,
      platform: "win32",
    });
    const sessions = summary.sessions.filter(
      (record) => record.source === "hermes",
    );
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.sessionId, "win_hermes_1");
    assert.equal(sessions[0]?.projectRef, "~/win-project");
    assertPrivacyClean(sessions[0]!);
  });
});

// ---------------------------------------------------------------------------
// WorkBuddy session reader — one JSONL conversation per session.
// ---------------------------------------------------------------------------

test("WorkBuddy: reads one conversation with ai-title, usage and dedupe", async () => {
  await withTempHome(async (home) => {
    const sessionDirectory = join(home, ".workbuddy", "projects", "demo");
    const conversationId = "dffe8d5b-2436-4022-b549-d9c227385c19";
    const projectDir = join(home, "wb-project");
    await mkdir(sessionDirectory, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    const base = new Date("2026-09-09T04:50:43.359Z").getTime();
    await writeFile(
      join(sessionDirectory, `${conversationId}.jsonl`),
      [
        JSON.stringify({
          id: "u-1",
          timestamp: base,
          role: "user",
          content: "Help me fix this bug",
          sessionId: conversationId,
          cwd: projectDir,
        }),
        JSON.stringify({
          id: "title-1",
          timestamp: base + 200,
          type: "ai-title",
          aiTitle: "Debug the login page",
          sessionId: conversationId,
          cwd: projectDir,
        }),
        JSON.stringify({
          id: "resp-1",
          timestamp: base + 1000,
          type: "function_call",
          sessionId: conversationId,
          cwd: projectDir,
          providerData: {
            requestModelName: "deepseek-chat",
            rawUsage: {
              prompt_tokens: 1_000,
              completion_tokens: 200,
              cache_read_input_tokens: 300,
              cache_creation_input_tokens: 100,
              completion_tokens_details: { reasoning_tokens: 50 },
            },
          },
        }),
        // Duplicate response id (rotated/in-flight copy) must count once.
        JSON.stringify({
          id: "resp-1",
          timestamp: base + 1000,
          sessionId: conversationId,
          cwd: projectDir,
          providerData: {
            rawUsage: { prompt_tokens: 1_000, completion_tokens: 200 },
          },
        }),
        JSON.stringify({
          id: "asst-1",
          timestamp: base + 1500,
          role: "assistant",
          content: "Done",
          sessionId: conversationId,
          cwd: projectDir,
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "workbuddy");
    assert.equal(session.sessionId, conversationId);
    assert.equal(session.title, "Debug the login page");
    assert.equal(session.model, "deepseek-chat");
    assert.equal(session.projectKey, "wb-project");
    assert.equal(session.projectRef, "~/wb-project");
    assert.equal(session.turns, 1);
    assert.equal(session.totals.inputTokens, 600);
    assert.equal(session.totals.cachedInputTokens, 300);
    assert.equal(session.totals.cacheCreationInputTokens, 100);
    assert.equal(session.totals.outputTokens, 150);
    assert.equal(session.totals.reasoningOutputTokens, 50);
    assert.equal(session.totals.totalTokens, 1_200);
    assert.equal(session.resumeSafe, false);
    assertPrivacyClean(session);
  });
});

test("WorkBuddy: user text is the fallback title without an ai-title record", async () => {
  await withTempHome(async (home) => {
    const sessionDirectory = join(home, ".workbuddy", "projects", "demo2");
    await mkdir(sessionDirectory, { recursive: true });
    const conversationId = "9a8b7c6d-1111-2222-3333-444455556666";
    await writeFile(
      join(sessionDirectory, `${conversationId}.jsonl`),
      [
        JSON.stringify({
          id: "u-2",
          timestamp: new Date("2026-09-09T05:00:00.000Z").getTime(),
          role: "user",
          content: "Summarize https://example.com/docs for me",
          sessionId: conversationId,
          cwd: join(home, "docs-project"),
        }),
      ].join("\n") + "\n",
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const session = soleSession(summary.sessions);
    assert.equal(session.source, "workbuddy");
    assert.equal(session.title, "Summarize [link] for me");
    assert.equal(session.turns, 1);
    assert.equal(session.totals.totalTokens, 0);
    assert.equal(session.projectRef, "~/docs-project");
    assertPrivacyClean(session);
  });
});

// ZCode — ~/.zcode/cli/db/db.sqlite: one top-level session per conversation;
// subagent children (session.parent_id) are folded into the parent record.
function createZcodeSessionDb(
  databasePath: string,
  sessions: Array<{
    id: string;
    parentId?: string | null;
    title?: string;
    directory?: string;
    timeCreated: number;
    timeUpdated: number;
  }>,
  usage: Array<{
    sessionId: string;
    modelId: string;
    startedAt: number;
    completedAt: number;
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheCreation: number;
  }>,
  userMessages: Array<{ sessionId: string; atMs: number }>,
): void {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT,
      time_created INTEGER, time_updated INTEGER
    );
    CREATE TABLE model_usage (
      id TEXT PRIMARY KEY, session_id TEXT, model_id TEXT, started_at INTEGER,
      completed_at INTEGER, input_tokens INTEGER, output_tokens INTEGER,
      reasoning_tokens INTEGER, cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER,
      time_created INTEGER
    );
  `);
  const insertSession = db.prepare(
    `INSERT INTO session (id, parent_id, title, directory, time_created, time_updated)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const row of sessions) {
    insertSession.run(
      row.id,
      row.parentId ?? null,
      row.title ?? null,
      row.directory ?? null,
      row.timeCreated,
      row.timeUpdated,
    );
  }
  const insertUsage = db.prepare(
    `INSERT INTO model_usage (id, session_id, model_id, started_at, completed_at,
       input_tokens, output_tokens, reasoning_tokens,
       cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  usage.forEach((row, index) => {
    insertUsage.run(
      `usage-${index}`,
      row.sessionId,
      row.modelId,
      row.startedAt,
      row.completedAt,
      row.input,
      row.output,
      row.reasoning,
      row.cacheCreation,
      row.cacheRead,
    );
  });
  const insertMessage = db.prepare(
    `INSERT INTO message (id, session_id, data, sequence, time_created)
     VALUES (?, ?, ?, ?, ?)`,
  );
  userMessages.forEach((row, index) => {
    insertMessage.run(
      `msg-${index}`,
      row.sessionId,
      JSON.stringify({
        role: "user",
        time: { created: row.atMs },
        agent: "zcode-agent",
      }),
      index,
      row.atMs,
    );
  });
  db.close();
}

test("ZCode: one parent session with folded subagent usage and totals", async () => {
  await withTempHome(async (home) => {
    const dbDir = join(home, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const projectDir = join(home, "code", "zapp");
    const parentAt = new Date("2026-09-08T02:00:00.000Z").getTime();
    const childAt = new Date("2026-09-08T02:05:00.000Z").getTime();
    createZcodeSessionDb(
      join(dbDir, "db.sqlite"),
      [
        {
          id: "sess-parent-abc123",
          title: "修复登录流程",
          directory: projectDir,
          timeCreated: parentAt,
          timeUpdated: childAt + 60_000,
        },
        {
          id: "sess-child-xyz789",
          parentId: "sess-parent-abc123",
          title: "子代理分析",
          directory: projectDir,
          timeCreated: childAt,
          timeUpdated: childAt + 60_000,
        },
        {
          // Orphan child whose parent session was pruned must never surface.
          id: "sess-orphan-000001",
          parentId: "sess-missing-parent",
          title: "孤儿会话",
          directory: projectDir,
          timeCreated: childAt,
          timeUpdated: childAt,
        },
      ],
      [
        {
          sessionId: "sess-parent-abc123",
          modelId: "deepseek-v4-pro",
          startedAt: parentAt + 1_000,
          completedAt: parentAt + 20_000,
          input: 30000,
          output: 1000,
          reasoning: 200,
          cacheRead: 20000,
          cacheCreation: 0,
        },
        {
          sessionId: "sess-child-xyz789",
          modelId: "zcode-Explore",
          startedAt: childAt + 1_000,
          completedAt: childAt + 40_000,
          input: 5000,
          output: 600,
          reasoning: 100,
          cacheRead: 0,
          cacheCreation: 0,
        },
        {
          sessionId: "sess-orphan-000001",
          modelId: "deepseek-v4-pro",
          startedAt: childAt,
          completedAt: childAt + 5_000,
          input: 999,
          output: 999,
          reasoning: 0,
          cacheRead: 0,
          cacheCreation: 0,
        },
      ],
      [
        { sessionId: "sess-parent-abc123", atMs: parentAt + 500 },
        { sessionId: "sess-parent-abc123", atMs: childAt - 30_000 },
        { sessionId: "sess-child-xyz789", atMs: childAt + 500 },
        { sessionId: "sess-orphan-000001", atMs: childAt + 400 },
      ],
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    const zcode = summary.sessions.filter(
      (record) => record.source === "zcode",
    );
    assert.equal(zcode.length, 1, "only the top-level session is listed");
    const session = zcode[0]!;
    assert.equal(session.sessionId, "sess-parent-abc123");
    assert.equal(session.title, "修复登录流程");
    assert.equal(session.model, "deepseek-v4-pro");
    assert.equal(session.projectKey, "zapp");
    assert.equal(session.projectRef, "~/code/zapp");
    // Parent 31000 + child 5600; orphan usage never leaks into totals.
    assert.equal(session.totals.inputTokens, 15000);
    assert.equal(session.totals.cachedInputTokens, 20000);
    assert.equal(session.totals.outputTokens, 1300);
    assert.equal(session.totals.reasoningOutputTokens, 300);
    assert.equal(session.totals.totalTokens, 36600);
    assert.equal(session.turns, 3);
    assert.equal(session.subagentCalls, 1);
    assert.equal(session.resumeSafe, false);
    assert.equal(session.resumeCommand, null);
    assert.equal(session.status, "available");
    assertPrivacyClean(session);
  });
});

test("ZCode: a database with only orphaned child sessions lists nothing", async () => {
  await withTempHome(async (home) => {
    const dbDir = join(home, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const at = new Date("2026-09-08T02:00:00.000Z").getTime();
    createZcodeSessionDb(
      join(dbDir, "db.sqlite"),
      [
        {
          id: "sess-child-only-1",
          parentId: "sess-missing-parent",
          title: "子会话",
          timeCreated: at,
          timeUpdated: at,
        },
      ],
      [],
      [],
    );

    const summary = await scanLocalSessions({ homeDirectory: home, now: NOW });
    assert.equal(
      summary.sessions.filter((record) => record.source === "zcode").length,
      0,
    );
  });
});
