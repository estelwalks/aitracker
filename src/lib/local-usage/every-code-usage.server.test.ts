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
 * Every Code CLI usage support: the registry declares a native reader
 * (`every-code-rollout-v1`) over `~/.code/sessions` (macOS and Windows homes),
 * matching every `rollout-*.jsonl` recursively at any depth. Every Code is a
 * Codex-family CLI: the rollout lines follow the codex schema — `turn_context`
 * lines (payload.model/cwd) plus token rows whose `last_token_usage` is
 * preferred and whose `total_token_usage` falls back to per-stream cumulative
 * differences. Both envelopes are accepted: the flat
 * `payload.type === "token_count"` form and the nested
 * `payload.msg.type === "token_count"` form Every Code actually writes. These
 * tests run the real scan pipeline against a win32 fixture pinning that
 * contract (cached-input subtraction, cache_write merged into cache creation,
 * component summation, zero-sum skipping) and the per-file cache reuse.
 */

const SESSION_ID = "every-code-session-demo";
const MODEL = "every-code-test";
const CWD = "~/every-code-demo";
const SESSION_META_TIME = "2026-09-01T09:00:00.000Z";

interface RolloutRow {
  timestamp: string;
  type: string;
  payload?: Record<string, unknown>;
}

function rolloutLine(row: RolloutRow): string {
  return JSON.stringify({
    timestamp: row.timestamp,
    type: row.type,
    ...(row.payload == null ? {} : { payload: row.payload }),
  });
}

function sessionMetaRow(): string {
  return rolloutLine({
    timestamp: SESSION_META_TIME,
    type: "session_meta",
    payload: { type: "session_meta", id: SESSION_ID },
  });
}

function turnContextRow(timestamp: string): string {
  return rolloutLine({
    timestamp,
    type: "turn_context",
    payload: { type: "turn_context", model: MODEL, cwd: CWD },
  });
}

/** Flat envelope: `payload.type === "token_count"`. */
function flatTokenCountRow(
  timestamp: string,
  info: Record<string, unknown>,
): string {
  return rolloutLine({
    timestamp,
    type: "event_msg",
    payload: { type: "token_count", info },
  });
}

/** Nested envelope: `payload.msg.type === "token_count"`. */
function nestedTokenCountRow(
  timestamp: string,
  info: Record<string, unknown>,
): string {
  return rolloutLine({
    timestamp,
    type: "event_msg",
    payload: {
      type: "event_msg",
      msg: { type: "token_count", info },
    },
  });
}

async function writeRollout(path: string, rows: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.join("\n")}\n`, "utf8");
}

test("every-code usage adapter reads Codex-family rollout JSONL with both token-count envelopes", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-every-code-"));
  try {
    const sessionsDir = join(root, ".code", "sessions");
    const rolloutFile = join(
      sessionsDir,
      "2026",
      "09",
      "01",
      "rollout-xxx.jsonl",
    );

    await writeRollout(rolloutFile, [
      sessionMetaRow(),
      turnContextRow("2026-09-01T09:00:01.000Z"),
      // Nested envelope (`payload.msg.type === "token_count"`, the real Every
      // Code form) with per-turn last usage: input -= cached (100 - 30 = 70).
      nestedTokenCountRow("2026-09-01T09:00:02.000Z", {
        last_token_usage: {
          input_tokens: 100,
          cached_input_tokens: 30,
          output_tokens: 10,
        },
      }),
      // Flat envelope (`payload.type === "token_count"`): cache_write merges
      // into cache creation (15 + 5) and reasoning sums separately from
      // output.
      flatTokenCountRow("2026-09-01T09:00:03.000Z", {
        last_token_usage: {
          input_tokens: 200,
          cached_input_tokens: 40,
          cache_creation_input_tokens: 15,
          cache_write_input_tokens: 5,
          output_tokens: 25,
          reasoning_output_tokens: 4,
        },
      }),
      // Total-only row without a predecessor: no `last_token_usage`, nothing
      // to diff against yet — it only seeds the cumulative cursor.
      flatTokenCountRow("2026-09-01T09:00:04.000Z", {
        total_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 50,
          output_tokens: 30,
        },
      }),
      // Second total-only row (nested envelope): diffed against the previous
      // totals — input 360-300=60 minus cached 60-50=10 -> 50, cache creation
      // 20, output 38-30=8, reasoning 6.
      nestedTokenCountRow("2026-09-01T09:00:05.000Z", {
        total_token_usage: {
          input_tokens: 360,
          cached_input_tokens: 60,
          cache_creation_input_tokens: 20,
          output_tokens: 38,
          reasoning_output_tokens: 6,
          total_tokens: 484,
        },
      }),
      // Zero-sum row (transient mid-write) never surfaces as an event.
      nestedTokenCountRow("2026-09-01T09:00:06.000Z", {
        last_token_usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
        },
      }),
    ]);

    const options = {
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32" as const,
      now: new Date("2026-09-02T12:00:00.000Z"),
      wslTopology: {
        distros: [],
        enumeratedAt: new Date("2026-09-02T12:00:00.000Z").toISOString(),
        failed: true,
      },
    };

    const snapshot = await scanLocalUsage(options);
    const everyCode = snapshot.sources.find(
      (source) => source.source === "every-code",
    );
    assert.ok(everyCode, "every-code source must be reported");
    assert.equal(everyCode.available, true);
    assert.equal(everyCode.detected, true);
    assert.equal(everyCode.events, 3);
    assert.equal(everyCode.filesConsidered, 1);
    assert.equal(everyCode.filesRead, 1);
    assert.equal(everyCode.filesParsed, 1);
    assert.equal(everyCode.filesReused, 0);
    assert.equal(everyCode.malformedLines, 0);
    assert.deepEqual(everyCode.paths, [sessionsDir]);

    const events = snapshot.details.filter(
      (event) => event.source === "every-code",
    );
    assert.equal(events.length, 3);
    for (const event of events) {
      assert.equal(event.model, MODEL);
      assert.equal(event.project, CWD);
      assert.equal(
        event.sessionId,
        sessionIdFromStructuredValue("every-code", SESSION_ID),
      );
      assert.ok(isPrivateSessionId(event.sessionId ?? ""));
      assert.ok(
        event.sessionId !== sessionIdFromStructuredValue("codex", SESSION_ID),
        "every-code session ids must not share the codex namespace",
      );
    }

    // Nested last-usage event: input = 100 - 30 cached = 70.
    const nested = events.find((event) => event.totalTokens === 110);
    assert.ok(nested, "nested-envelope last-usage event present");
    assert.equal(nested.inputTokens, 70);
    assert.equal(nested.cachedInputTokens, 30);
    assert.equal(nested.cacheCreationInputTokens, 0);
    assert.equal(nested.outputTokens, 10);
    assert.equal(nested.reasoningOutputTokens, 0);
    assert.equal(nested.timestamp, "2026-09-01T09:00:02.000Z");

    // Flat last-usage event: input = 200 - 40 = 160, cache creation =
    // cache_creation 15 + cache_write 5 = 20.
    const flat = events.find((event) => event.totalTokens === 249);
    assert.ok(flat, "flat-envelope last-usage event present");
    assert.equal(flat.inputTokens, 160);
    assert.equal(flat.cachedInputTokens, 40);
    assert.equal(flat.cacheCreationInputTokens, 20);
    assert.equal(flat.outputTokens, 25);
    assert.equal(flat.reasoningOutputTokens, 4);
    assert.equal(flat.timestamp, "2026-09-01T09:00:03.000Z");

    // Total-difference event (second cumulative sample only): input diff
    // 60 minus cached diff 10 = 50.
    const diffed = events.find((event) => event.totalTokens === 94);
    assert.ok(diffed, "total-diff event present");
    assert.equal(diffed.inputTokens, 50);
    assert.equal(diffed.cachedInputTokens, 10);
    assert.equal(diffed.cacheCreationInputTokens, 20);
    assert.equal(diffed.outputTokens, 8);
    assert.equal(diffed.reasoningOutputTokens, 6);
    assert.equal(diffed.timestamp, "2026-09-01T09:00:05.000Z");

    // The unchanged rollout tree is served from the persistent per-file cache.
    const second = await scanLocalUsage(options);
    const secondEveryCode = second.sources.find(
      (source) => source.source === "every-code",
    );
    assert.ok(secondEveryCode);
    assert.equal(secondEveryCode.filesParsed, 0);
    assert.equal(secondEveryCode.filesReused, 1);
    assert.equal(secondEveryCode.events, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
