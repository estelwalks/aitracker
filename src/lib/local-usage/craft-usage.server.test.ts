import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Craft Agents usage support (TokenTracker-sourced): the registry declares a
 * generic-jsonl adapter over each session's `session.jsonl` header (a
 * cumulative snapshot that is rewritten in place as the session grows). The
 * header carries the tokenUsage object; later message lines carry no usage
 * and never produce events.
 */

const HEADER_LINE = (over: Record<string, unknown>): string =>
  JSON.stringify({
    id: "sess-craft-1",
    sdkSessionId: "sdk-1",
    model: "claude-sonnet-4-5",
    createdAt: Date.parse("2026-09-01T09:00:00.000Z"),
    lastUsedAt: Date.parse("2026-09-01T10:00:00.000Z"),
    lastMessageAt: Date.parse("2026-09-01T10:05:00.000Z"),
    tokenUsage: {
      inputTokens: 5000,
      outputTokens: 1200,
      totalTokens: 6400,
      cacheReadTokens: 900,
      cacheCreationTokens: 100,
      reasoningTokens: 200,
      contextTokens: 5000,
      contextWindow: 200000,
    },
    ...over,
  });

test("craft usage adapter reads session headers as cumulative snapshot events", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-craft-"));
  try {
    const sessionDir = join(
      root,
      ".craft-agent",
      "workspaces",
      "proj",
      "sessions",
      "sess-craft-1",
    );
    await mkdir(sessionDir, { recursive: true });
    // Header line carries the running totals; the message lines that follow
    // carry no tokenUsage and must not produce events.
    await writeFile(
      join(sessionDir, "session.jsonl"),
      [
        HEADER_LINE({}),
        JSON.stringify({ type: "message", role: "assistant" }),
      ].join("\n") + "\n",
    );
    // A second session whose cumulative tokens exceed its component fields:
    // the totalTokens key wins only when no components were observed; here
    // components exist so the event total equals their sum.
    const sessionDir2 = join(
      root,
      ".craft-agent",
      "workspaces",
      "proj",
      "sessions",
      "sess-craft-zero",
    );
    await mkdir(sessionDir2, { recursive: true });
    await writeFile(
      join(sessionDir2, "session.jsonl"),
      HEADER_LINE({
        id: "sess-craft-zero",
        model: undefined,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
      }) + "\n",
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const craft = snapshot.sources.find((source) => source.source === "craft");
    assert.ok(craft, "craft source must be reported");
    assert.equal(craft.available, true);
    assert.equal(craft.events, 1);

    const events = snapshot.details.filter((event) => event.source === "craft");
    assert.equal(events.length, 1);
    const event = events[0]!;
    assert.equal(
      event.sessionId,
      sessionIdFromStructuredValue("craft", "sess-craft-1"),
    );
    assert.equal(event.model, "claude-sonnet-4-5");
    assert.equal(event.inputTokens, 5000);
    assert.equal(event.cachedInputTokens, 900);
    assert.equal(event.cacheCreationInputTokens, 100);
    assert.equal(event.outputTokens, 1200);
    assert.equal(event.reasoningOutputTokens, 200);
    // Components sum: 5000+900+100+1200+200 = 7400.
    assert.equal(event.totalTokens, 7400);
    // Header timestamps are epoch ms; lastMessageAt wins.
    assert.equal(event.timestamp, "2026-09-01T10:05:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
