import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { zstdCompressSync } from "node:zlib";

import { scanLocalUsage } from "./scanner.server.ts";
import {
  isPrivateSessionId,
  sessionIdFromStructuredValue,
} from "./session-id.ts";

/**
 * Zed Agent (threads.db) usage support (TokenTracker-sourced): the registry
 * declares a native reader over the Zed `threads.db` (macOS Application
 * Support / Windows %LOCALAPPDATA% / XDG dataHome `zed/threads`). A row
 * stores the whole thread JSON as utf8 (`data_type='json'`) or as zstd-
 * compressed utf8 (`data_type='zstd'`); each scan emits one event per thread
 * with its CURRENT cumulative totals (request_token_usage summed when
 * present, cumulative_token_usage as the fallback). These tests run the real
 * scan pipeline against sqlite fixtures pinning that contract.
 */

function threadJson({
  provider = "zed.dev",
  model,
  request = {},
  cumulative = {},
  imported = false,
}: {
  provider?: string;
  model: string;
  request?: unknown;
  cumulative?: unknown;
  imported?: boolean;
}): Buffer {
  return Buffer.from(
    JSON.stringify({
      version: "0.3.0",
      title: "fixture thread",
      messages: [],
      model: { provider, model },
      request_token_usage: request,
      cumulative_token_usage: cumulative,
      imported,
    }),
    "utf8",
  );
}

function createZedDb(path: string, rows: unknown[][]): void {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE threads (id TEXT, updated_at TEXT, data_type TEXT, data BLOB);",
  );
  const insert = db.prepare(
    "INSERT INTO threads (id, updated_at, data_type, data) VALUES (?, ?, ?, ?)",
  );
  for (const row of rows) insert.run(...(row as never[]));
  db.close();
}

test("zed usage adapter reads threads.db rows with json and zstd thread blobs", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zed-"));
  try {
    const threadsDir = join(root, "AppData", "Local", "Zed", "threads");
    await mkdir(threadsDir, { recursive: true });
    createZedDb(join(threadsDir, "threads.db"), [
      // Plain-json thread: request_token_usage as an ARRAY whose two entries
      // mix numeric strings and numbers (cache_read / cache_creation included).
      [
        "th-json-1",
        "2026-05-01T14:00:00Z",
        "json",
        threadJson({
          provider: "zed.dev",
          model: "claude-sonnet-4",
          request: [
            {
              input_tokens: 100,
              output_tokens: "20",
              cache_read_input_tokens: "5",
              cache_creation_input_tokens: 2,
            },
            {
              input_tokens: "50",
              output_tokens: 10,
              cache_read_input_tokens: 7,
              cache_creation_input_tokens: "3",
            },
          ],
          // A non-empty cumulative must LOSE to the summed request usage.
          cumulative: { input_tokens: 99999, output_tokens: 99999 },
        }),
      ],
      // zstd-compressed thread: request_token_usage as a MAP (real shape).
      [
        "th-zstd-2",
        "2026-05-01T15:00:00Z",
        "zstd",
        zstdCompressSync(
          threadJson({
            provider: "copilot_chat",
            model: "gpt-5.5",
            request: {
              "r-1": {
                input_tokens: 1100,
                output_tokens: 626,
                cache_read_input_tokens: 50176,
              },
              "r-2": {
                input_tokens: 41884,
                output_tokens: 533,
                cache_read_input_tokens: 48640,
              },
            },
          }),
        ),
      ],
      // Imported threads are never events.
      [
        "th-imported-3",
        "2026-05-01T16:00:00Z",
        "json",
        threadJson({
          provider: "zed.dev",
          model: "claude-opus-4",
          request: [{ input_tokens: 500000, output_tokens: 500000 }],
          imported: true,
        }),
      ],
      // Empty per-request usage falls back to cumulative_token_usage; the
      // bring-your-own provider (anthropic) is counted because no provider is
      // double-counted (ZED_DOUBLE_COUNTED_PROVIDERS is empty, mirroring
      // TokenTracker — Zed's providers never overlap a dedicated reader).
      [
        "th-fallback-4",
        "2026-05-01T17:00:00Z",
        "json",
        threadJson({
          provider: "anthropic",
          model: "claude-opus-4",
          request: {},
          cumulative: {
            input_tokens: "700",
            output_tokens: 300,
            cache_read_input_tokens: "10",
            cache_creation_input_tokens: 5,
          },
        }),
      ],
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const zed = snapshot.sources.find((source) => source.source === "zed");
    assert.ok(zed, "zed source must be reported");
    assert.equal(zed.available, true);
    assert.equal(zed.detected, true);
    assert.equal(zed.events, 3);

    const events = snapshot.details.filter((event) => event.source === "zed");
    assert.equal(events.length, 3);

    const plain = events.find(
      (event) =>
        event.sessionId === sessionIdFromStructuredValue("zed", "th-json-1"),
    );
    assert.ok(plain, "plain-json thread event present");
    assert.equal(plain.model, "claude-sonnet-4");
    assert.equal(plain.inputTokens, 150);
    assert.equal(plain.outputTokens, 30);
    assert.equal(plain.cachedInputTokens, 12);
    assert.equal(plain.cacheCreationInputTokens, 5);
    assert.equal(plain.reasoningOutputTokens, 0);
    assert.equal(plain.totalTokens, 197);
    assert.equal(plain.timestamp, "2026-05-01T14:00:00.000Z");

    const zstd = events.find(
      (event) =>
        event.sessionId === sessionIdFromStructuredValue("zed", "th-zstd-2"),
    );
    assert.ok(zstd, "zstd thread event present");
    assert.equal(zstd.model, "gpt-5.5");
    assert.equal(zstd.inputTokens, 42984);
    assert.equal(zstd.outputTokens, 1159);
    assert.equal(zstd.cachedInputTokens, 98816);
    assert.equal(zstd.cacheCreationInputTokens, 0);
    assert.equal(zstd.totalTokens, 142959);
    assert.equal(zstd.timestamp, "2026-05-01T15:00:00.000Z");

    const fallback = events.find(
      (event) =>
        event.sessionId ===
        sessionIdFromStructuredValue("zed", "th-fallback-4"),
    );
    assert.ok(fallback, "cumulative-fallback thread event present");
    assert.equal(fallback.model, "claude-opus-4");
    assert.equal(fallback.inputTokens, 700);
    assert.equal(fallback.outputTokens, 300);
    assert.equal(fallback.cachedInputTokens, 10);
    assert.equal(fallback.cacheCreationInputTokens, 5);
    assert.equal(fallback.totalTokens, 1015);
    assert.equal(fallback.timestamp, "2026-05-01T17:00:00.000Z");

    // Imported threads must not produce events.
    assert.equal(
      events.some(
        (event) =>
          event.sessionId ===
          sessionIdFromStructuredValue("zed", "th-imported-3"),
      ),
      false,
    );
    // Every event carries an opaque structured session id.
    for (const event of events) {
      assert.ok(
        event.sessionId != null && isPrivateSessionId(event.sessionId),
        "zed events must carry an opaque session_ id",
      );
      assert.ok(
        event.sessionId?.startsWith("session_"),
        "zed session ids use the structured session_ prefix",
      );
    }

    // An unchanged database is served from the persistent per-file cache.
    const second = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const secondZed = second.sources.find((source) => source.source === "zed");
    assert.ok(secondZed);
    assert.equal(secondZed.filesParsed, 0);
    assert.equal(secondZed.filesReused, 1);
    assert.equal(secondZed.events, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Issue #42, native-reader half: `threads.db` accumulates one row per
 * conversation, so it can pass the adapter's 512 MB `maxFileSizeBytes` on a
 * long-lived install. The native reader applies its own byte gate, which had
 * the same effect as the generic one - the database was skipped before the
 * thread query ran.
 */
test("zed threads.db above maxFileSizeBytes is still queried", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zed-oversize-"));
  try {
    const threadsDir = join(root, "AppData", "Local", "Zed", "threads");
    await mkdir(threadsDir, { recursive: true });
    const databasePath = join(threadsDir, "threads.db");
    createZedDb(databasePath, [
      [
        "th-oversize-1",
        "2026-05-01T14:00:00Z",
        "json",
        threadJson({
          provider: "zed.dev",
          model: "claude-sonnet-4",
          request: [
            {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 5,
              cache_creation_input_tokens: 2,
            },
          ],
        }),
      ],
    ]);

    // Trailing bytes land on free pages, so the thread row stays queryable.
    const cap = 536_870_912;
    const handle = await open(databasePath, "r+");
    try {
      await handle.truncate(cap + 8 * 1024 * 1024);
    } finally {
      await handle.close();
    }
    const { size } = await stat(databasePath);
    assert.ok(size > cap, "fixture must exceed the adapter byte cap");

    const probe = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const rows = probe
        .prepare("SELECT COUNT(*) AS n FROM threads")
        .all() as Array<{ n: number }>;
      assert.equal(rows[0]?.n, 1, "padded database must stay queryable");
    } finally {
      probe.close();
    }

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const zed = snapshot.sources.find((source) => source.source === "zed");
    assert.ok(zed, "zed source must be reported");
    assert.equal(
      zed.events,
      1,
      "an oversized threads.db must still yield its rows",
    );
    assert.deepEqual(
      zed.diagnostics ?? [],
      [],
      "file size must not produce a file-too-large diagnostic for sqlite",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Review finding: `updated_at` is an ISO TEXT column and the window bound was
 * a numeric cutoff, so SQLite applied TEXT affinity to the parameter and
 * compared lexicographically - "2020-01-01T00:00:00Z" >= "1786..." is true, so
 * the filter matched history instead of excluding it and the window did
 * nothing. The same query had no ORDER BY, so once the row budget stopped the
 * walk it kept the OLDEST rows and dropped the newest.
 */
test("zed window excludes old threads and keeps the newest under a budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zed-window-"));
  try {
    const threadsDir = join(root, "AppData", "Local", "Zed", "threads");
    await mkdir(threadsDir, { recursive: true });
    const now = new Date("2026-09-09T08:00:00.000Z");
    const day = 86_400_000;
    const thread = (input: number) =>
      threadJson({
        provider: "zed.dev",
        model: "claude-sonnet-4",
        request: [{ input_tokens: input, output_tokens: 1 }],
      });
    // Inserted oldest first, so an unordered walk under a budget keeps these.
    createZedDb(join(threadsDir, "threads.db"), [
      ["th-old", "2020-01-01T00:00:00Z", "json", thread(1_000)],
      [
        "th-mid",
        new Date(now.getTime() - 100 * day).toISOString(),
        "json",
        thread(2_000),
      ],
      [
        "th-new",
        new Date(now.getTime() - 1 * day).toISOString(),
        "json",
        thread(3_000),
      ],
    ]);
    const options = {
      homeDirectory: root,
      cacheDirectory: root,
      platform: "win32" as const,
      now,
      disablePersistentCache: true,
    };

    // The 2020 row must be gone: a numeric comparison would have kept it.
    const narrow = await scanLocalUsage({ ...options, lookbackDays: 30 });
    const narrowEvents = narrow.details.filter((e) => e.source === "zed");
    assert.equal(narrowEvents.length, 1, "only the recent thread is in window");
    assert.equal(narrowEvents[0]!.inputTokens, 3_000);

    // With a budget of two the newest two must survive, not the oldest two.
    const capped = await scanLocalUsage({
      ...options,
      lookbackDays: 3650,
      maxSqliteRowsPerSource: 2,
    });
    const cappedEvents = capped.details
      .filter((e) => e.source === "zed")
      .map((event) => event.inputTokens)
      .sort((a, b) => a - b);
    assert.deepEqual(
      cappedEvents,
      [2_000, 3_000],
      "a capped walk must keep the newest threads",
    );
    assert.ok(
      (capped.sources.find((s) => s.source === "zed")?.diagnostics ?? []).some(
        (entry) => entry.code === "query-truncated",
      ),
      "truncation must be reported",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
