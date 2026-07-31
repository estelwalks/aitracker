import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectTokenTrackerUsage,
  initializeTokenTrackerUsage,
} from "./tokentracker-bridge.server.ts";

test("clean first run initializes TokenTracker hooks before a local drain sync", async () => {
  const root = join(tmpdir(), `trusttools-tokentracker-bootstrap-${process.pid}-${Date.now()}`);
  const home = join(root, "home");
  const sessionDirectory = join(home, ".codex", "sessions", "2026", "07", "29");
  const sessionFile = join(sessionDirectory, "rollout-bootstrap-test.jsonl");
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(join(home, ".codex", "config.toml"), 'model = "gpt-5"\n', "utf8");
  await writeFile(
    sessionFile,
    [
      JSON.stringify({
        timestamp: "2026-07-29T10:00:00.000Z",
        type: "session_meta",
        payload: { type: "session_meta", id: "bootstrap-test-session" },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T10:00:01.000Z",
        type: "turn_context",
        payload: { type: "turn_context", model: "gpt-5", cwd: join(home, "project") },
      }),
      JSON.stringify({
        timestamp: "2026-07-29T10:00:02.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 20,
              output_tokens: 30,
              reasoning_output_tokens: 10,
            },
          },
        },
      }),
    ].join("\n") + "\n",
    "utf8",
  );

  try {
    await initializeTokenTrackerUsage({ homeDirectory: home });
    const result = await collectTokenTrackerUsage({
      forceSync: true,
      homeDirectory: home,
    });
    const stateTracker = join(
      home,
      ".trusttools",
      "tokentracker-runtime",
      ".tokentracker",
      "tracker",
    );
    const config = await readFile(join(stateTracker, "config.json"), "utf8");
    assert.match(config, /installedAt/);
    const codexConfig = await readFile(join(home, ".codex", "config.toml"), "utf8");
    assert.match(codexConfig, /notify/);
    const log = await readFile(
      join(home, ".trusttools", "logs", "local-usage-bootstrap.log"),
      "utf8",
    );
    assert.match(log, /tracker init --yes --no-auth --no-open/);
    assert.match(log, /tracker sync --drain --auto/);
    assert.ok(result.events.some((event) => event.source === "codex" && event.totalTokens > 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
