import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Mimo Code (mimocode) usage support (TokenTracker-sourced): the registry
 * declares a generic-sqlite adapter over the mimocode OpenCode-fork database
 * (`mimocode.db` at Windows AppData\Roaming\mimocode / macOS+Linux
 * ~/.local/share/mimocode). mimocode mirrors the user's Claude Code and
 * claude-mem history into the same `message` table, so genuine usage is only
 * the rows whose `data.providerID` is `mimo` or `xiaomi` — providerID, never
 * the model id, because a mimo-named model run inside Claude Code is logged
 * with providerID=anthropic and already counted by the Claude parser. Each
 * assistant row carries a JSON `data` payload with disjoint token components
 * (input / output / reasoning / cache.read / cache.write). These tests run the
 * real scan pipeline against sqlite fixtures pinning that contract.
 */

const SCHEMA = `
CREATE TABLE message (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL,
  data TEXT NOT NULL
);
`;

interface MimoTokenCounts {
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

interface MimoMessageRow {
  id: string;
  sessionId: string;
  role: string;
  model: string;
  provider: string;
  tokens: MimoTokenCounts;
  timeCreated: number;
  timeUpdated: number;
  cwd?: string;
}

function createMimoDb(path: string, rows: MimoMessageRow[]): void {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO message (id, session_id, time_created, time_updated, data)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(
      row.id,
      row.sessionId,
      row.timeCreated,
      row.timeUpdated,
      JSON.stringify({
        id: row.id,
        sessionID: row.sessionId,
        role: row.role,
        modelID: row.model,
        providerID: row.provider,
        cost: 0,
        tokens: {
          input: row.tokens.input ?? 0,
          output: row.tokens.output ?? 0,
          reasoning: row.tokens.reasoning ?? 0,
          cache: {
            read: row.tokens.cacheRead ?? 0,
            write: row.tokens.cacheWrite ?? 0,
          },
        },
        time: { created: row.timeCreated, completed: row.timeUpdated },
        ...(row.cwd ? { path: { cwd: row.cwd, root: row.cwd } } : {}),
      }),
    );
  }
  db.close();
}

test("mimo usage adapter reads native mimo/xiaomi assistant rows and drops mirrored Claude rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-mimo-"));
  try {
    const dbDir = join(root, "AppData", "Roaming", "mimocode");
    await mkdir(dbDir, { recursive: true });
    const projectDir = join(root, "code", "mimo-app");
    await mkdir(projectDir, { recursive: true });

    const base = Math.floor(Date.now() / 1000) * 1000 - 3 * 24 * 60 * 60 * 1000;
    createMimoDb(join(dbDir, "mimocode.db"), [
      {
        // Genuine mimo usage — mimo's own auto router (providerID=mimo).
        id: "msg-mimo-1",
        sessionId: "ses-mimo-1",
        role: "assistant",
        model: "mimo-auto",
        provider: "mimo",
        tokens: { input: 500, output: 25, reasoning: 40, cacheRead: 100 },
        timeCreated: base - 10_000,
        timeUpdated: base,
        cwd: projectDir,
      },
      {
        // Xiaomi-provider mimo variant — kept.
        id: "msg-xiaomi-2",
        sessionId: "ses-xiaomi-2",
        role: "assistant",
        model: "mimo-v2.5-pro-ultraspeed",
        provider: "xiaomi",
        tokens: { input: 30, output: 10 },
        timeCreated: base + 50_000,
        timeUpdated: base + 60_000,
      },
      {
        // Mirrored Claude Code history — providerID=anthropic. Must be dropped
        // (already counted as source=claude), even with huge cache reads.
        id: "msg-claude-3",
        sessionId: "ses-mirror-3",
        role: "assistant",
        model: "claude-opus-4-8",
        provider: "anthropic",
        tokens: {
          input: 1000,
          output: 5000,
          cacheRead: 900_000,
          cacheWrite: 50_000,
        },
        timeCreated: base + 110_000,
        timeUpdated: base + 120_000,
      },
      {
        // CRUCIAL: a mimo-named model run INSIDE Claude Code is logged with
        // providerID=anthropic (it lives in ~/.claude and is counted as
        // source=claude). Keying off the model id would double-count it.
        id: "msg-mimo-in-claude-4",
        sessionId: "ses-mirror-4",
        role: "assistant",
        model: "mimo-v2.5-pro",
        provider: "anthropic",
        tokens: { input: 200, output: 50 },
        timeCreated: base + 170_000,
        timeUpdated: base + 180_000,
      },
      {
        // Zero-token assistant rows never become events.
        id: "msg-zero-5",
        sessionId: "ses-zero-5",
        role: "assistant",
        model: "mimo-auto",
        provider: "mimo",
        tokens: {},
        timeCreated: base + 230_000,
        timeUpdated: base + 240_000,
      },
      {
        // Non-assistant rows are never events.
        id: "msg-user-6",
        sessionId: "ses-user-6",
        role: "user",
        model: "",
        provider: "mimo",
        tokens: { input: 100, output: 100 },
        timeCreated: base + 290_000,
        timeUpdated: base + 300_000,
      },
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const mimo = snapshot.sources.find((source) => source.source === "mimo");
    assert.ok(mimo, "mimo source must be reported");
    assert.equal(mimo.available, true);
    assert.equal(mimo.filesParsed, 1);
    assert.equal(mimo.events, 2);

    const events = snapshot.details.filter((event) => event.source === "mimo");
    assert.equal(events.length, 2);

    const native = events.find(
      (event) =>
        event.sessionId === sessionIdFromStructuredValue("mimo", "ses-mimo-1"),
    );
    assert.ok(native, "native mimo event present");
    assert.equal(native.model, "mimo-auto");
    assert.equal(native.inputTokens, 500);
    assert.equal(native.cachedInputTokens, 100);
    assert.equal(native.cacheCreationInputTokens, 0);
    assert.equal(native.outputTokens, 25);
    assert.equal(native.reasoningOutputTokens, 40);
    // Components sum back to the stored token total (input + output +
    // reasoning + cache read + cache write).
    assert.equal(native.totalTokens, 665);
    assert.equal(native.timestamp, new Date(base).toISOString());
    assert.equal((native.project ?? "").includes("code/mimo-app"), true);

    const xiaomi = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("mimo", "ses-xiaomi-2"),
    );
    assert.ok(xiaomi, "xiaomi-provider mimo event present");
    assert.equal(xiaomi.model, "mimo-v2.5-pro-ultraspeed");
    assert.equal(xiaomi.inputTokens, 30);
    assert.equal(xiaomi.outputTokens, 10);
    assert.equal(xiaomi.totalTokens, 40);
    assert.equal(xiaomi.timestamp, new Date(base + 60_000).toISOString());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("mimo usage adapter yields no events for a mirror-only mimocode.db", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-mimo-mirror-"));
  try {
    const dbDir = join(root, "AppData", "Roaming", "mimocode");
    await mkdir(dbDir, { recursive: true });
    const base = Math.floor(Date.now() / 1000) * 1000 - 2 * 24 * 60 * 60 * 1000;
    createMimoDb(join(dbDir, "mimocode.db"), [
      {
        id: "msg-mirror-1",
        sessionId: "ses-mirror-1",
        role: "assistant",
        model: "claude-sonnet-4-5",
        provider: "anthropic",
        tokens: { input: 10, output: 300, cacheRead: 800_000 },
        timeCreated: base,
        timeUpdated: base,
      },
      {
        id: "msg-mirror-2",
        sessionId: "ses-mirror-2",
        role: "assistant",
        model: "mimo-v2.5-pro",
        provider: "anthropic",
        tokens: { input: 1000, output: 200 },
        timeCreated: base + 60_000,
        timeUpdated: base + 60_000,
      },
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const mimo = snapshot.sources.find((source) => source.source === "mimo");
    assert.ok(mimo, "mimo source must be reported");
    // The database exists and was parsed, but every row is a Claude mirror —
    // none of it may surface under the mimo source (double-count guard).
    assert.equal(mimo.filesParsed, 1);
    assert.equal(mimo.events, 0);
    assert.equal(mimo.available, false);
    const events = snapshot.details.filter((event) => event.source === "mimo");
    assert.equal(events.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
