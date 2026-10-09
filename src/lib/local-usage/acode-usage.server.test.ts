import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

const SESSION_ID = "acode-session-demo";

function line(row: Record<string, unknown>): string {
  return JSON.stringify(row);
}

async function writeRollout(path: string, rows: string[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${rows.join("\n")}\n`, "utf8");
}

test("acode usage reader reuses Codex-family rollout parsing under its own source", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-acode-"));
  try {
    const sessionsDir = join(root, ".acode", "sessions");
    await writeRollout(
      join(sessionsDir, "2026", "09", "01", "rollout-a.jsonl"),
      [
        line({
          timestamp: "2026-09-01T09:00:00.000Z",
          type: "session_meta",
          payload: {
            type: "session_meta",
            id: SESSION_ID,
            cwd: "~/acode-demo",
          },
        }),
        line({
          timestamp: "2026-09-01T09:00:01.000Z",
          type: "turn_context",
          payload: {
            type: "turn_context",
            model: "acode-model",
            cwd: "~/acode-demo",
          },
        }),
        line({
          timestamp: "2026-09-01T09:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 25,
                cache_creation_input_tokens: 5,
                output_tokens: 20,
                reasoning_output_tokens: 3,
              },
            },
          },
        }),
      ],
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "darwin",
      now: new Date("2026-09-02T12:00:00.000Z"),
      wslTopology: {
        distros: [],
        enumeratedAt: new Date("2026-09-02T12:00:00.000Z").toISOString(),
        failed: true,
      },
    });

    const summary = snapshot.sources.find(
      (source) => source.source === "acode",
    );
    assert.ok(summary, "acode source must be reported");
    assert.equal(summary.available, true);
    assert.equal(summary.detected, true);
    assert.equal(summary.events, 1);
    assert.deepEqual(summary.paths, [
      sessionsDir,
      join(root, ".acode", "archived_sessions"),
    ]);

    const event = snapshot.details.find((item) => item.source === "acode");
    assert.ok(event, "acode event must be present");
    assert.equal(event.model, "acode-model");
    assert.equal(event.project, "~/acode-demo");
    assert.equal(event.inputTokens, 75);
    assert.equal(event.cachedInputTokens, 25);
    assert.equal(event.cacheCreationInputTokens, 5);
    assert.equal(event.outputTokens, 20);
    assert.equal(event.reasoningOutputTokens, 3);
    assert.equal(event.totalTokens, 128);
    assert.equal(
      event.sessionId,
      sessionIdFromStructuredValue("acode", SESSION_ID),
    );
    assert.notEqual(
      event.sessionId,
      sessionIdFromStructuredValue("codex", SESSION_ID),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
