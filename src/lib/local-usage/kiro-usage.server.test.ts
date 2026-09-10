import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Kiro usage support (TokenTracker-sourced): the registry declares a
 * generic-sqlite adapter over the Kiro Agent `devdata.sqlite` (under
 * Kiro/User/globalStorage/kiro.kiroagent in macOS Application Support /
 * Windows AppData\Roaming / Linux XDG config). One `tokens_generated` row per
 * request carries input/output tokens and a naive-UTC timestamp. These tests
 * run the real scan pipeline against sqlite fixtures pinning that contract.
 */

test("kiro usage adapter reads tokens_generated rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-kiro-"));
  try {
    const dataDir = join(
      root,
      "AppData",
      "Roaming",
      "Kiro",
      "User",
      "globalStorage",
      "kiro.kiroagent",
      "dev_data",
    );
    await mkdir(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, "devdata.sqlite"));
    db.exec(`
      CREATE TABLE tokens_generated (
        id INTEGER PRIMARY KEY,
        model TEXT,
        provider TEXT,
        tokens_prompt INTEGER,
        tokens_generated INTEGER,
        timestamp TEXT
      );
    `);
    const insert = db.prepare(
      `INSERT INTO tokens_generated (id, model, provider, tokens_prompt, tokens_generated, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    insert.run(1, "gpt-5", "openai", 1200, 300, "2026-09-01 10:00:00");
    insert.run(2, "", "anthropic", 500, 120, "2026-09-01 10:05:00");
    // Zero-token rows never become events.
    insert.run(3, "gpt-5", "openai", 0, 0, "2026-09-01 10:10:00");
    // Rows without a usable timestamp are skipped.
    insert.run(4, "gpt-5", "openai", 100, 50, null);
    db.close();

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const kiro = snapshot.sources.find((source) => source.source === "kiro");
    assert.ok(kiro, "kiro source must be reported");
    assert.equal(kiro.available, true);
    assert.equal(kiro.events, 2);

    const events = snapshot.details.filter((event) => event.source === "kiro");
    assert.equal(events.length, 2);
    const first = events.find(
      (event) => event.sessionId === sessionIdFromStructuredValue("kiro", "1"),
    );
    assert.ok(first, "first kiro event present");
    assert.equal(first.model, "gpt-5");
    assert.equal(first.inputTokens, 1200);
    assert.equal(first.outputTokens, 300);
    assert.equal(first.reasoningOutputTokens, 0);
    assert.equal(first.totalTokens, 1500);
    // Naive UTC timestamp must not shift into the local zone.
    assert.equal(first.timestamp, "2026-09-01T10:00:00.000Z");

    const fallback = events.find(
      (event) => event.sessionId === sessionIdFromStructuredValue("kiro", "2"),
    );
    assert.ok(fallback);
    assert.equal(fallback.model, "kiro-agent");
    assert.equal(fallback.totalTokens, 620);
    assert.equal(fallback.timestamp, "2026-09-01T10:05:00.000Z");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
