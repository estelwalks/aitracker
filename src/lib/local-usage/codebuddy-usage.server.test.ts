import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import {
  isPrivateSessionId,
  sessionIdFromStructuredValue,
} from "./session-id.ts";

/**
 * CodeBuddy CLI usage support (TokenTracker-sourced): the registry declares a
 * native reader over the `~/.codebuddy/projects` tree (macOS and Windows
 * homes), matching every `*.jsonl` transcript recursively at any depth. Each session
 * transcript stores one row per record; ANY record type (assistant message or
 * function_call) whose `providerData.rawUsage` is present is one LLM
 * round-trip, and the function_call/message rows of the same round-trip share
 * `providerData.messageId` (deduped, first row in file order wins). These
 * tests run the real scan pipeline against win32 fixtures pinning the
 * TokenTracker token math (cached-read mirrors max, cache-write mirror,
 * input subtraction, reasoning min) and the per-file cache contract.
 */

interface TranscriptRowFixture {
  type: string;
  role?: string;
  sessionId?: string;
  model?: string;
  messageId: string;
  rawUsage: Record<string, unknown>;
  /** Epoch milliseconds (or seconds, exercising the coerce fallback). */
  timestamp: number;
}

function transcriptRow(fixture: TranscriptRowFixture): string {
  const row: Record<string, unknown> = {
    type: fixture.type,
    timestamp: fixture.timestamp,
    ...(fixture.sessionId == null ? {} : { sessionId: fixture.sessionId }),
    ...(fixture.role == null ? {} : { role: fixture.role }),
    providerData: {
      ...(fixture.model == null ? {} : { model: fixture.model }),
      messageId: fixture.messageId,
      rawUsage: fixture.rawUsage,
    },
  };
  return JSON.stringify(row);
}

async function writeTranscript(path: string, rows: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.join("\n")}\n`, "utf8");
}

test("codebuddy usage adapter reads per-round-trip JSONL rawUsage totals", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-codebuddy-"));
  try {
    const projectsDir = join(root, ".codebuddy", "projects");
    const now = Date.now();
    // Row timestamps pinned to fixed offsets from "now" so they always land
    // inside the scan's lookback window.
    const ts1 = now - 3 * 60 * 60 * 1000;
    const ts2 = now - 2 * 60 * 60 * 1000;
    const ts3 = now - 60 * 60 * 1000;
    const ts4Seconds = Math.floor((now - 30 * 60 * 1000) / 1000);

    // Session "sess-abc-1" lives under an encoded-cwd directory
    // (c-Users-u-Proj) inside the projects root.
    const sessionFile = join(projectsDir, "c-Users-u-Proj", "sess-abc-1.jsonl");
    await writeTranscript(sessionFile, [
      // Round-trip 1: a function_call / assistant-message PAIR sharing
      // providerData.messageId "rt-1" — only the first row may become an
      // event (TokenTracker's seenIds semantics on a from-scratch parse).
      transcriptRow({
        type: "function_call",
        sessionId: "sess-abc-1",
        model: "glm-4.6",
        messageId: "rt-1",
        rawUsage: {
          prompt_tokens: 22223,
          completion_tokens: 250,
          prompt_tokens_details: { cached_tokens: 512 },
          completion_tokens_details: { reasoning_tokens: 0 },
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        timestamp: ts1,
      }),
      transcriptRow({
        type: "message",
        role: "assistant",
        sessionId: "sess-abc-1",
        model: "glm-4.6",
        messageId: "rt-1",
        rawUsage: {
          prompt_tokens: 22223,
          completion_tokens: 250,
          prompt_tokens_details: { cached_tokens: 512 },
          completion_tokens_details: { reasoning_tokens: 0 },
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        timestamp: ts1,
      }),
      // Round-trip 2: every cache mirror is present — cachedRead must be the
      // max of prompt_tokens_details.cached_tokens (500),
      // prompt_cache_hit_tokens (550) and cache_read_input_tokens (100);
      // cacheCreation must be the max of cache_creation_input_tokens (60)
      // and prompt_cache_write_tokens (80); reasoning is capped at
      // completion_tokens.
      transcriptRow({
        type: "message",
        role: "assistant",
        sessionId: "sess-abc-1",
        model: "glm-4.6",
        messageId: "rt-2",
        rawUsage: {
          prompt_tokens: 10000,
          completion_tokens: 400,
          prompt_tokens_details: {
            cached_tokens: 500,
            reasoning_tokens: 0,
          },
          completion_tokens_details: { reasoning_tokens: 150 },
          prompt_cache_hit_tokens: 550,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 60,
          prompt_cache_write_tokens: 80,
        },
        timestamp: ts2,
      }),
      // Zero-sum round-trip: transient mid-write payloads never surface.
      transcriptRow({
        type: "function_call",
        sessionId: "sess-abc-1",
        model: "glm-4.6",
        messageId: "rt-3",
        rawUsage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 0 },
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        timestamp: ts3,
      }),
      // Round-trip 4: no providerData.model (falls back to "unknown") and the
      // timestamp is epoch SECONDS — must be scaled to milliseconds. Its full
      // completion volume is reasoning output.
      transcriptRow({
        type: "message",
        role: "assistant",
        sessionId: "sess-abc-1",
        messageId: "rt-4",
        rawUsage: {
          prompt_tokens: 500,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 50 },
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        timestamp: ts4Seconds,
      }),
      // Record types without rawUsage (reasoning/topic/user rows) are
      // structurally skipped, never malformed.
      JSON.stringify({ type: "reasoning", text: "thinking..." }),
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const codebuddy = snapshot.sources.find(
      (source) => source.source === "codebuddy",
    );
    assert.ok(codebuddy, "codebuddy source must be reported");
    assert.equal(codebuddy.available, true);
    assert.equal(codebuddy.detected, true);
    assert.equal(codebuddy.events, 3);
    assert.equal(codebuddy.filesConsidered, 1);
    assert.equal(codebuddy.filesRead, 1);
    assert.equal(codebuddy.filesParsed, 1);
    assert.equal(codebuddy.filesReused, 0);
    assert.equal(codebuddy.malformedLines, 0);

    const events = snapshot.details.filter(
      (event) => event.source === "codebuddy",
    );
    assert.equal(events.length, 3);

    const sessionEvents = events.filter(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("codebuddy", "sess-abc-1"),
    );
    assert.equal(sessionEvents.length, 3);

    // Round-trip 1: prompt_tokens INCLUDES the cached 512, so input must be
    // 22223 - 512 = 21711 (TokenTracker's reference sample split).
    const rt1 = sessionEvents.find((event) => event.totalTokens === 22473);
    assert.ok(rt1, "round-trip 1 event present");
    assert.equal(rt1.model, "glm-4.6");
    assert.equal(rt1.inputTokens, 21711);
    assert.equal(rt1.cachedInputTokens, 512);
    assert.equal(rt1.cacheCreationInputTokens, 0);
    assert.equal(rt1.outputTokens, 250);
    assert.equal(rt1.reasoningOutputTokens, 0);
    assert.equal(rt1.project, "unknown");
    assert.equal(rt1.timestamp, new Date(ts1).toISOString());

    // Round-trip 2: cachedRead = max(500, 550, 100) = 550,
    // cacheCreation = max(60, 80) = 80, input = 10000 - 550 - 80 = 9370,
    // reasoning = min(400, 150) = 150, output = 400 - 150 = 250.
    const rt2 = sessionEvents.find((event) => event.totalTokens === 10400);
    assert.ok(rt2, "round-trip 2 event present");
    assert.equal(rt2.model, "glm-4.6");
    assert.equal(rt2.inputTokens, 9370);
    assert.equal(rt2.cachedInputTokens, 550);
    assert.equal(rt2.cacheCreationInputTokens, 80);
    assert.equal(rt2.outputTokens, 250);
    assert.equal(rt2.reasoningOutputTokens, 150);
    assert.equal(rt2.timestamp, new Date(ts2).toISOString());

    // Round-trip 4: no model (-> "unknown") and the seconds timestamp is
    // scaled to milliseconds; reasoning consumes all of completion_tokens.
    const rt4 = sessionEvents.find((event) => event.totalTokens === 550);
    assert.ok(rt4, "round-trip 4 event present");
    assert.equal(rt4.model, "unknown");
    assert.equal(rt4.inputTokens, 500);
    assert.equal(rt4.cachedInputTokens, 0);
    assert.equal(rt4.cacheCreationInputTokens, 0);
    assert.equal(rt4.outputTokens, 0);
    assert.equal(rt4.reasoningOutputTokens, 50);
    assert.equal(rt4.timestamp, new Date(ts4Seconds * 1000).toISOString());

    // Every event carries an opaque structured session id.
    for (const event of events) {
      assert.ok(
        event.sessionId != null && isPrivateSessionId(event.sessionId),
        "codebuddy events must carry an opaque session_ id",
      );
    }

    // An unchanged projects tree is served from the persistent per-file cache.
    const second = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const secondCodebuddy = second.sources.find(
      (source) => source.source === "codebuddy",
    );
    assert.ok(secondCodebuddy);
    assert.equal(secondCodebuddy.filesParsed, 0);
    assert.equal(secondCodebuddy.filesReused, 1);
    assert.equal(secondCodebuddy.events, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
