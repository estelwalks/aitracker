import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";

/**
 * ZCode usage support: the registry declares a generic-sqlite adapter reading
 * `model_usage` rows (joined to `session` for the working directory) from
 * `~/.zcode/cli/db/db.sqlite`. ZCode writes the database in WAL mode and its
 * token semantics are DeepSeek-style — `input_tokens` already contains cached
 * input and `output_tokens` already contains reasoning tokens — so the adapter
 * decomposes the classes instead of double counting. These tests run the real
 * scan pipeline against sqlite fixtures to pin the adapter contract.
 */

const SCHEMA = `
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  directory TEXT
);
CREATE TABLE model_usage (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  model_id TEXT,
  status TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER
);
`;

interface ZcodeUsageRow {
  sessionId: string;
  directory?: string;
  model?: string;
  startedAt: number;
  completedAt?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cacheCreation?: number;
  cacheRead?: number;
}

function createZcodeDb(
  path: string,
  sessionDirectories: ReadonlyMap<string, string>,
  rows: ZcodeUsageRow[],
  wal = false,
): void {
  const db = new DatabaseSync(path);
  if (wal) db.exec("PRAGMA journal_mode=WAL");
  db.exec(SCHEMA);
  const insertSession = db.prepare(
    `INSERT INTO session (id, directory) VALUES (?, ?)`,
  );
  for (const [sessionId, directory] of sessionDirectories) {
    insertSession.run(sessionId, directory);
  }
  const insert = db.prepare(
    `INSERT INTO model_usage (id, session_id, model_id, status, started_at,
       completed_at, input_tokens, output_tokens, reasoning_tokens,
       cache_creation_input_tokens, cache_read_input_tokens)
     VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
  );
  rows.forEach((row, index) => {
    insert.run(
      `usage-${index}`,
      row.sessionId,
      row.model ?? "deepseek-v4-pro",
      row.startedAt,
      row.completedAt ?? row.startedAt + 10_000,
      row.input ?? 0,
      row.output ?? 0,
      row.reasoning ?? 0,
      row.cacheCreation ?? 0,
      row.cacheRead ?? 0,
    );
  });
  db.close();
}

test("zcode usage adapter reads model_usage rows with decomposed tokens", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const projectDir = join(root, "code", "zapp");
    await mkdir(projectDir, { recursive: true });
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    createZcodeDb(
      join(dbDir, "db.sqlite"),
      new Map([["sess-a-1111", projectDir]]),
      [
        {
          sessionId: "sess-a-1111",
          // Provider total = input + output = 31000; cached input (20000) is
          // inside input_tokens and reasoning (200) inside output_tokens.
          startedAt: base,
          completedAt: base + 20_000,
          input: 30000,
          output: 1000,
          reasoning: 200,
          cacheRead: 20000,
          cacheCreation: 0,
        },
        {
          sessionId: "sess-a-1111",
          startedAt: base + 60_000,
          completedAt: base + 70_000,
          input: 4000,
          output: 300,
          reasoning: 50,
          cacheRead: 1000,
          cacheCreation: 0,
        },
        {
          // Zero-token rows must never become events.
          sessionId: "sess-a-1111",
          startedAt: base + 120_000,
          completedAt: base + 130_000,
          input: 0,
          output: 0,
        },
      ],
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      // The registry declares this adapter for linux too, and the scan must not
      // depend on the OS running the suite.
      platform: "linux" as const,
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(zcode.available, true);
    assert.equal(zcode.filesParsed, 1);
    assert.equal(zcode.events, 2);

    const events = snapshot.details.filter((event) => event.source === "zcode");
    assert.equal(events.length, 2);
    const first = events.find((event) => event.totalTokens === 31000);
    assert.ok(first, "first event present");
    assert.match(first.sessionId ?? "", /^session_[a-f0-9]{20}$/u);
    assert.equal(first.model, "deepseek-v4-pro");
    // Fresh input excludes cached input; output excludes reasoning.
    assert.equal(first.inputTokens, 10000);
    assert.equal(first.cachedInputTokens, 20000);
    assert.equal(first.cacheCreationInputTokens, 0);
    assert.equal(first.outputTokens, 800);
    assert.equal(first.reasoningOutputTokens, 200);
    // Components sum back to the provider total (input + output).
    assert.equal(first.totalTokens, 31000);
    assert.notEqual(first.project, "unknown");
    const second = events.find((event) => event.inputTokens === 3000);
    assert.ok(second);
    assert.equal(second.cachedInputTokens, 1000);
    assert.equal(second.outputTokens, 250);
    assert.equal(second.totalTokens, 4300);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zcode WAL-mode database re-parses when only the -wal file changed", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-wal-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const databasePath = join(dbDir, "db.sqlite");
    const writer = new DatabaseSync(databasePath);
    writer.exec("PRAGMA journal_mode=WAL");
    writer.exec(SCHEMA);
    const insertSession = writer.prepare(
      `INSERT INTO session (id, directory) VALUES (?, ?)`,
    );
    insertSession.run("sess-wal-1111", join(root, "proj"));
    const insert = writer.prepare(
      `INSERT INTO model_usage (id, session_id, model_id, status, started_at,
         completed_at, input_tokens, output_tokens, reasoning_tokens,
         cache_creation_input_tokens, cache_read_input_tokens)
       VALUES (?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    const writeRow = (index: number): void => {
      insert.run(
        `usage-wal-${index}`,
        "sess-wal-1111",
        "deepseek-v4-pro",
        base + index * 10_000,
        base + index * 10_000 + 5_000,
        100,
        50,
        10,
        0,
        0,
      );
    };
    writeRow(0);

    const options = {
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "linux" as const,
    };
    const first = await scanLocalUsage(options);
    const firstZcode = first.sources.find(
      (source) => source.source === "zcode",
    );
    assert.ok(firstZcode);
    assert.equal(firstZcode.events, 1);

    // Insert a fresh usage row through the still-open writer WITHOUT letting
    // the main database file change (no checkpoint). The scan must notice the
    // changed -wal companion and re-parse instead of serving the cached row.
    writeRow(1);

    const second = await scanLocalUsage(options);
    const secondZcode = second.sources.find(
      (source) => source.source === "zcode",
    );
    assert.ok(secondZcode);
    assert.equal(secondZcode.events, 2, "fresh WAL rows must be collected");
    assert.equal(secondZcode.filesParsed, 1, "file must have been re-parsed");
    assert.equal(
      secondZcode.filesReused,
      0,
      "stale cache entry must not be reused",
    );
    writer.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zcode data-directory override rebases usage roots to the chosen dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-override-"));
  try {
    const dataDir = join(root, "zcode-data");
    await mkdir(join(dataDir, "cli", "db"), { recursive: true });
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    createZcodeDb(join(dataDir, "cli", "db", "db.sqlite"), new Map(), [
      {
        sessionId: "sess-reloc-1111",
        model: "deepseek-v4-pro",
        startedAt: base,
        input: 2000,
        output: 500,
      },
    ]);
    // A stale default ~/.zcode that must be ignored while the override is set.
    await mkdir(join(root, ".zcode", "cli", "db"), { recursive: true });
    createZcodeDb(join(root, ".zcode", "cli", "db", "db.sqlite"), new Map(), [
      {
        sessionId: "sess-stale-2222",
        startedAt: base,
        input: 9999,
        output: 9999,
      },
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "linux" as const,
      toolDataRoots: new Map([["zcode", dataDir]]),
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(zcode.events, 1, "only override data is scanned");
    const events = snapshot.details.filter((event) => event.source === "zcode");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.inputTokens, 2000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Issue #42: ZCode stores every session's message/part plaintext in the same
 * `db.sqlite` as its usage rows, so a real install passes the adapter's
 * 512 MB `maxFileSizeBytes` within weeks of heavy use. The byte cap belongs to
 * formats that are buffered whole (json/jsonl); a sqlite database is queried
 * through a prepared statement, and the cap used to skip the file before that
 * query ever ran - a working adapter reported "no logs" forever.
 */
test("sqlite usage file above maxFileSizeBytes is still queried", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-oversize-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const databasePath = join(dbDir, "db.sqlite");
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    createZcodeDb(
      databasePath,
      new Map([["sess-oversize-1111", join(root, "proj")]]),
      [
        {
          sessionId: "sess-oversize-1111",
          startedAt: base,
          completedAt: base + 10_000,
          input: 30_000,
          output: 1_000,
          reasoning: 200,
          cacheRead: 20_000,
        },
      ],
    );

    // Grow the database past the adapter's 512 MB cap. Trailing bytes land on
    // free pages after the last committed one, so the rows stay queryable and
    // the assertion below can distinguish "read" from "silently skipped".
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
        .prepare("SELECT COUNT(*) AS n FROM model_usage")
        .all() as Array<{ n: number }>;
      assert.equal(rows[0]?.n, 1, "padded database must stay queryable");
    } finally {
      probe.close();
    }

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "linux" as const,
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(
      zcode.events,
      1,
      "an oversized sqlite file must still yield its rows",
    );
    assert.deepEqual(
      zcode.diagnostics ?? [],
      [],
      "file size must not produce a file-too-large diagnostic for sqlite",
    );
    const events = snapshot.details.filter((event) => event.source === "zcode");
    assert.equal(events.length, 1);
    // Input excludes cached input, output excludes reasoning (unchanged).
    assert.equal(events[0]!.inputTokens, 10_000);
    assert.equal(events[0]!.cachedInputTokens, 20_000);
    assert.equal(events[0]!.outputTokens, 800);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Issue #42, other half: lifting the byte cap must not mean "read without
 * limit". The row budget is passed through `maxSqliteRowsPerSource` so this
 * exercises the truncation path directly, and it pins the property that makes
 * the budget safe: because every sqlite query now orders newest-first, the rows
 * kept are the most recent ones and the oldest are the ones dropped. Without
 * that ordering this test fails - the scan would keep the five oldest sessions
 * and a heavy user would silently see stale numbers.
 */
test("sqlite row budget keeps the newest rows and reports truncation", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-cap-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const base = Date.parse("2026-09-09T08:00:00.000Z");
    const sessions = new Map<string, string>();
    const rows: ZcodeUsageRow[] = [];
    for (let index = 0; index < 5; index += 1) {
      const sessionId = `sess-cap-${index}`;
      sessions.set(sessionId, join(root, "proj", `p${index}`));
      rows.push({
        sessionId,
        startedAt: base,
        // One hour apart so "newest" is unambiguous.
        completedAt: base + index * 3_600_000,
        input: 100,
        output: 10,
      });
    }
    createZcodeDb(join(dbDir, "db.sqlite"), sessions, rows);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "linux" as const,
      // Fixture seam: the real budget is 500k rows.
      maxSqliteRowsPerSource: 3,
    });
    const zcode = snapshot.sources.find((source) => source.source === "zcode");
    assert.ok(zcode, "zcode source must be reported");
    assert.equal(zcode.events, 3, "the budget must cap the collected events");

    const truncated = (zcode.diagnostics ?? []).find(
      (entry) => entry.code === "query-truncated",
    );
    assert.ok(truncated, "truncation must be visible, never silent");
    assert.match(truncated.message, /3 行读取上限/u);
    // A row-count cap must never be reported as a size problem: the file is
    // fine, and a size diagnostic sends debugging back to the byte cap.
    assert.equal(
      (zcode.diagnostics ?? []).some(
        (entry) => entry.code === "file-too-large",
      ),
      false,
      "a row budget must not be reported as file-too-large",
    );

    const events = snapshot.details.filter((event) => event.source === "zcode");
    // The three newest completions (hours 4, 3 and 2), never the two oldest.
    assert.deepEqual(events.map((event) => event.timestamp).sort(), [
      new Date(base + 2 * 3_600_000).toISOString(),
      new Date(base + 3 * 3_600_000).toISOString(),
      new Date(base + 4 * 3_600_000).toISOString(),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Issue #42 follow-up: the cutoff has to reach sqlite. The adapter query used
 * to be a fixed string, so the scan read every historical row and dropped the
 * pre-cutoff ones in TypeScript - the cost of a multi-gigabyte database for a
 * window that only keeps a fraction of it. `windowFilter` is applied by
 * wrapping the adapter query in a subquery, and this pins that the window is
 * actually in force rather than merely declared.
 */
test("sqlite window filter keeps only rows inside the scan window", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-zcode-window-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const now = new Date("2026-09-09T08:00:00.000Z");
    const day = 86_400_000;
    const sessions = new Map([["sess-window", join(root, "proj")]]);
    createZcodeDb(join(dbDir, "db.sqlite"), sessions, [
      // 400 days old: outside a 365-day window, inside a 3650-day one.
      {
        sessionId: "sess-window",
        startedAt: now.getTime() - 400 * day,
        completedAt: now.getTime() - 400 * day,
        input: 1_000,
        output: 100,
      },
      // 10 days old: inside both.
      {
        sessionId: "sess-window",
        startedAt: now.getTime() - 10 * day,
        completedAt: now.getTime() - 10 * day,
        input: 2_000,
        output: 200,
      },
    ]);

    const scan = (lookbackDays: number) =>
      scanLocalUsage({
        homeDirectory: root,
        cacheDirectory: root,
        lookbackDays,
        platform: "linux" as const,
        now,
        disablePersistentCache: true,
      });

    const wide = await scan(3650);
    assert.equal(
      wide.sources.find((s) => s.source === "zcode")?.events,
      2,
      "a 3650-day window must include the 400-day-old row",
    );

    const narrow = await scan(365);
    const narrowZcode = narrow.sources.find((s) => s.source === "zcode");
    assert.equal(
      narrowZcode?.events,
      1,
      "a 365-day window must exclude the 400-day-old row",
    );
    const kept = narrow.details.filter((event) => event.source === "zcode");
    assert.equal(kept.length, 1);
    assert.equal(
      kept[0]!.timestamp,
      new Date(now.getTime() - 10 * day).toISOString(),
    );
    assert.equal(kept[0]!.inputTokens, 2_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** Registry codes the collector synthesizes rather than the scanner. */
const COLLECTOR_ONLY_DIAGNOSTIC_CODES = new Set(["retained-previous"]);

/**
 * Review finding: the persisted index validates every diagnostic against a
 * hand-written list, and `query-truncated` was missing from it. A truncation
 * warning therefore survived the first scan and vanished on the next restart,
 * which is exactly the silent behaviour the #42 work set out to remove. The
 * list is now annotated with the diagnostic union so TypeScript flags an
 * unclassified code at build time; this covers the runtime half, reading the
 * union out of the source so a new code cannot be forgotten here either.
 */
test("every scan-time diagnostic code survives the persisted index", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./types.ts", import.meta.url), "utf8");
  const union = source.slice(
    source.indexOf("export type LocalUsageDiagnosticCode"),
    source.indexOf("export interface LocalUsageDiagnostic"),
  );
  const codes = [...union.matchAll(/^\s*\|\s*"([a-z-]+)"/gmu)].map(
    (match) => match[1]!,
  );
  assert.ok(codes.length >= 6, `expected codes, parsed ${codes.length}`);
  assert.ok(codes.includes("query-truncated"));

  const scanner = await readFile(
    new URL("./scanner.server.ts", import.meta.url),
    "utf8",
  );
  const list = scanner.slice(
    scanner.indexOf("const CACHED_DIAGNOSTIC_CODES"),
    scanner.indexOf("function isCachedDiagnostic"),
  );
  for (const code of codes) {
    const cached = list.includes(`"${code}"`);
    if (COLLECTOR_ONLY_DIAGNOSTIC_CODES.has(code)) {
      assert.equal(
        cached,
        false,
        `${code} is synthesized by the collector and must not be cached`,
      );
      continue;
    }
    assert.ok(
      cached,
      `${code} must be in CACHED_DIAGNOSTIC_CODES or its diagnostics vanish on restart`,
    );
  }
});

test("a truncation warning survives a restart", async () => {
  const {
    __resetUsageScanIndexForTests,
    hydrateUsageScanIndex,
    snapshotUsageScanIndex,
  } = await import("./scanner.server.ts");
  const root = await mkdtemp(join(tmpdir(), "aitracker-truncation-restart-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const now = new Date("2026-09-09T08:00:00.000Z");
    const sessions = new Map([["sess-restart", join(root, "proj")]]);
    createZcodeDb(
      join(dbDir, "db.sqlite"),
      sessions,
      Array.from({ length: 6 }, (_, index) => ({
        sessionId: "sess-restart",
        startedAt: now.getTime() - index * 3_600_000,
        completedAt: now.getTime() - index * 3_600_000,
        input: 1_000 + index,
        output: 10,
      })),
    );
    const options = {
      homeDirectory: root,
      // The index is keyed by the home directory; the other tests in this file
      // use their own temp root, so this one owns its key.
      cacheDirectory: root,
      lookbackDays: 3650,
      platform: "linux" as const,
      now,
      maxSqliteRowsPerSource: 3,
    };

    __resetUsageScanIndexForTests();
    const first = await scanLocalUsage(options);
    const firstCodes = (
      first.sources.find((s) => s.source === "zcode")?.diagnostics ?? []
    ).map((entry) => entry.code);
    assert.deepEqual(firstCodes, ["query-truncated"]);

    // Simulate a restart: drop process state, restore what was persisted.
    const persisted = JSON.parse(JSON.stringify(snapshotUsageScanIndex()));
    __resetUsageScanIndexForTests();
    hydrateUsageScanIndex(persisted);

    const after = await scanLocalUsage(options);
    const zcode = after.sources.find((s) => s.source === "zcode");
    assert.equal(zcode?.filesReused, 1, "the persisted entry must be reused");
    assert.deepEqual(
      (zcode?.diagnostics ?? []).map((entry) => entry.code),
      ["query-truncated"],
      "a reused entry must still report the truncation it was parsed under",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("widening the lookback re-parses instead of serving a narrow cache", async () => {
  const { __resetUsageScanIndexForTests } = await import("./scanner.server.ts");
  const root = await mkdtemp(join(tmpdir(), "aitracker-window-cache-"));
  try {
    const dbDir = join(root, ".zcode", "cli", "db");
    await mkdir(dbDir, { recursive: true });
    const now = new Date("2026-09-09T08:00:00.000Z");
    const day = 86_400_000;
    createZcodeDb(
      join(dbDir, "db.sqlite"),
      new Map([["sess-window-cache", join(root, "proj")]]),
      [
        {
          sessionId: "sess-window-cache",
          startedAt: now.getTime() - 400 * day,
          completedAt: now.getTime() - 400 * day,
          input: 1_000,
          output: 10,
        },
        {
          sessionId: "sess-window-cache",
          startedAt: now.getTime() - 10 * day,
          completedAt: now.getTime() - 10 * day,
          input: 2_000,
          output: 20,
        },
      ],
    );
    const base = {
      homeDirectory: root,
      cacheDirectory: root,
      platform: "linux" as const,
      now,
    };

    // A windowed parse only holds the rows inside its window, so the cached
    // entry must not be reused for a wider request.
    __resetUsageScanIndexForTests();
    const narrow = await scanLocalUsage({ ...base, lookbackDays: 365 });
    assert.equal(
      narrow.sources.find((s) => s.source === "zcode")?.events,
      1,
      "365-day scan sees only the recent row",
    );

    const wide = await scanLocalUsage({ ...base, lookbackDays: 3650 });
    const wideZcode = wide.sources.find((s) => s.source === "zcode");
    assert.equal(
      wideZcode?.events,
      2,
      "widening the lookback must re-parse and pick up the older row",
    );
    assert.equal(
      wideZcode?.filesReused,
      0,
      "the narrow cache must not be reused",
    );

    // Narrowing again may reuse: the wider parse is a superset.
    const narrowAgain = await scanLocalUsage({ ...base, lookbackDays: 365 });
    const narrowAgainZcode = narrowAgain.sources.find(
      (s) => s.source === "zcode",
    );
    assert.equal(narrowAgainZcode?.filesReused, 1);
    assert.equal(narrowAgainZcode?.events, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
