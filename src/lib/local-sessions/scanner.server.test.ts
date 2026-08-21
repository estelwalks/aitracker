import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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
import { scanLocalSessions } from "./scanner.server.ts";
import type {
  SessionRecord,
  SessionSource,
  SessionTokenCounts,
} from "./types.ts";

const NOW = new Date("2026-08-03T12:00:00.000Z");

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "tt-sessions-"));
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
    registerSessionReader({
      key: readerKey,
      scan: async (root) => {
        scannedRoots.push(root);
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
      const summary = await scanLocalSessions({
        homeDirectory: home,
        now: NOW,
        registry,
      });
      // The scan root came from the platform path plan (storage.dataRoots +
      // home base), not from a hardcoded suffix.
      assert.deepEqual(scannedRoots, [join(home, ".fake")]);
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
    const cwd = join(home, "trusttools_webapp");
    const sessionDir = join(
      home,
      ".dsh",
      "sessions",
      "trusttools_webapp",
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
    assert.equal(session.projectKey, "trusttools_webapp");
    assert.equal(session.projectRef, "~/trusttools_webapp");
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
