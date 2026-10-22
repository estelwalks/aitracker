import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeCursorUsageCache } from "./cache.server.ts";
import { resolveCursorAccountPaths } from "./paths.server.ts";
import { scanLocalUsage } from "../local-usage/scanner.server.ts";
import { sessionIdFromStructuredValue } from "../local-usage/session-id.ts";

/**
 * The opt-in Cursor collector writes its account export to a cache file; the
 * offline scanner must read it exactly like any other local usage log. This
 * runs the real scan pipeline so the registry path, the default generic field
 * mapping and the cache shape stay pinned to each other.
 */
test("the Cursor account cache is read by the offline usage scan", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-cache-"));
  try {
    const paths = resolveCursorAccountPaths({
      homeDirectory: root,
      platform: "macos",
    });
    // Cursor being installed is what makes the source "detected".
    await mkdir(paths.appDir, { recursive: true });
    await mkdir(paths.cacheDirectory, { recursive: true });
    await writeCursorUsageCache(
      paths.cachePath,
      [
        {
          timestamp: "2026-10-21T06:56:12.521Z",
          session_id: "day-2026-10-21",
          model: "composer-2-fast",
          project: "cursor-account",
          usage: {
            input_tokens: 159990,
            cached_input_tokens: 578207,
            cache_creation_input_tokens: 10,
            output_tokens: 2055,
            reasoning_output_tokens: 0,
            total_tokens: 740262,
          },
        },
        {
          timestamp: "2026-10-20T10:00:00.000Z",
          session_id: "agent-agent-abc-1",
          model: "auto",
          project: "cursor-account",
          usage: {
            input_tokens: 1000,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 500,
            reasoning_output_tokens: 0,
            total_tokens: 1500,
          },
        },
      ],
      "2026-10-21T12:00:00.000Z",
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      disablePersistentCache: true,
      lookbackDays: 3650,
    });
    const cursor = snapshot.sources.find(
      (source) => source.source === "cursor",
    );
    assert.ok(cursor, "cursor source must be reported");
    assert.equal(cursor.available, true);
    assert.equal(cursor.events, 2);

    const events = snapshot.details.filter(
      (event) => event.source === "cursor",
    );
    assert.equal(events.length, 2);
    const bySession = new Map(events.map((event) => [event.sessionId, event]));
    const day = bySession.get(
      sessionIdFromStructuredValue("cursor", "day-2026-10-21")!,
    );
    assert.ok(day, "per-day account session id must survive hashing");
    assert.equal(day.model, "composer-2-fast");
    assert.equal(day.project, "cursor-account");
    assert.equal(day.inputTokens, 159990);
    assert.equal(day.cachedInputTokens, 578207);
    assert.equal(day.cacheCreationInputTokens, 10);
    assert.equal(day.outputTokens, 2055);
    assert.equal(day.totalTokens, 740262);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without a synced cache the Cursor source stays empty", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-nocache-"));
  try {
    const paths = resolveCursorAccountPaths({
      homeDirectory: root,
      platform: "macos",
    });
    await mkdir(paths.appDir, { recursive: true });
    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      disablePersistentCache: true,
      lookbackDays: 3650,
    });
    const cursor = snapshot.sources.find(
      (source) => source.source === "cursor",
    );
    assert.ok(cursor, "cursor source must still be reported for detection");
    assert.equal(cursor.events, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
