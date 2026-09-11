import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { sessionIdFromStructuredValue } from "./session-id.ts";

/**
 * Hermes Agent usage support (milestone v1.0.1): the registry declares a
 * generic-sqlite adapter reading the `sessions` table of `state.db` (default
 * profile plus `profiles/<name>/state.db`, matching the layout TokenTracker
 * reverse-engineered). These tests run the real scan pipeline against sqlite
 * fixtures so the adapter contract (columns, epoch seconds, active sessions,
 * multi-profile glob) is pinned by behaviour, not by mock.
 */

const SESSIONS_SCHEMA = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  model TEXT,
  started_at INTEGER,
  ended_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  message_count INTEGER
) STRICT;
`;

function insertHermesRows(path: string, rows: unknown[][]): void {
  const db = new DatabaseSync(path);
  const insert = db.prepare(
    `INSERT INTO sessions (
       id, model, started_at, ended_at, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of rows) insert.run(...(row as never[]));
  db.close();
}

function createHermesDb(path: string, rows: unknown[][]): void {
  const db = new DatabaseSync(path);
  db.exec(SESSIONS_SCHEMA);
  db.close();
  insertHermesRows(path, rows);
}

test("hermes data-directory override rebases usage roots to the chosen dir", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-override-"));
  const epoch = Math.floor(Date.now() / 1000);
  try {
    // Data lives OUTSIDE the home directory (portable/custom install like
    // `D:\hermes`): the fixture contains state.db at the top of the chosen
    // directory plus a nested profile, exactly like a relocated HERMES_HOME.
    const dataDir = join(root, "hermes-data");
    await mkdir(join(dataDir, "profiles", "team"), { recursive: true });
    createHermesDb(join(dataDir, "state.db"), [
      [
        "sess_reloc_done",
        "hermes-agent",
        epoch - 7200,
        epoch - 3600,
        500,
        250,
        0,
        0,
        50,
        5,
      ],
    ]);
    createHermesDb(join(dataDir, "profiles", "team", "state.db"), [
      [
        "sess_reloc_team",
        "hermes-agent",
        epoch - 3600,
        epoch - 1800,
        300,
        100,
        0,
        0,
        0,
        3,
      ],
    ]);
    // A stale default ~/.hermes that must be ignored while the override is set.
    await mkdir(join(root, ".hermes"), { recursive: true });
    createHermesDb(join(root, ".hermes", "state.db"), [
      [
        "sess_stale_default",
        "hermes-agent",
        epoch - 7200,
        epoch - 3600,
        9999,
        9999,
        0,
        0,
        0,
        1,
      ],
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      toolDataRoots: new Map([["hermes", dataDir]]),
    });
    const hermes = snapshot.sources.find(
      (source) => source.source === "hermes",
    );
    assert.ok(hermes, "hermes source must be reported");
    assert.equal(hermes.events, 2, "only override data is scanned");
    const ids = new Set(
      snapshot.details
        .filter((event) => event.source === "hermes")
        .map((event) => event.sessionId),
    );
    assert.equal(
      ids.has(sessionIdFromStructuredValue("hermes", "sess_reloc_done")),
      true,
    );
    assert.equal(
      ids.has(sessionIdFromStructuredValue("hermes", "sess_reloc_team")),
      true,
    );
    assert.equal(
      ids.has(sessionIdFromStructuredValue("hermes", "sess_stale_default")),
      false,
    );
    // Privacy note: the raw scanner summary legitimately carries the absolute
    // override root; projections that cross the browser boundary strip or
    // filter non-~/ paths (see toPublicUsageSnapshot and normalizeForDisplay).
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hermes usage adapter reads default + profile state.db sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-"));
  const epoch = Math.floor(Date.now() / 1000);
  try {
    const hermesDir = join(root, ".hermes");
    await mkdir(join(hermesDir, "profiles", "work"), { recursive: true });
    await mkdir(join(hermesDir, "profiles", "personal"), {
      recursive: true,
    });

    // Default profile DB: one completed session, one in-progress session
    // (ended_at NULL - Hermes updates token counts in real time), one
    // zero-token row that must never become an event.
    createHermesDb(join(hermesDir, "state.db"), [
      [
        "sess_default_done",
        "hermes-agent",
        epoch - 7200,
        epoch - 3600,
        1000,
        500,
        200,
        50,
        100,
        42,
      ],
      [
        "sess_default_active",
        "deepseek-r1",
        epoch - 600,
        null,
        800,
        300,
        0,
        0,
        400,
        10,
      ],
      ["sess_zero", "hermes-agent", epoch - 100, epoch - 90, 0, 0, 0, 0, 0, 0],
    ]);
    // Profile DBs carry their own session ids.
    createHermesDb(join(hermesDir, "profiles", "work", "state.db"), [
      [
        "sess_work_1",
        "hermes-agent",
        epoch - 5400,
        epoch - 5000,
        400,
        100,
        0,
        25,
        0,
        7,
      ],
    ]);
    createHermesDb(join(hermesDir, "profiles", "personal", "state.db"), [
      [
        "sess_personal_1",
        "claude-sonnet-4-5",
        epoch - 86400 * 3,
        epoch - 86400 * 3 + 900,
        2000,
        1000,
        500,
        100,
        200,
        20,
      ],
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
    });
    const hermes = snapshot.sources.find(
      (source) => source.source === "hermes",
    );
    assert.ok(hermes, "hermes source must be reported");
    assert.equal(hermes.available, true);
    assert.equal(hermes.events, 4, "one event per non-zero session row");

    const events = snapshot.details.filter(
      (event) => event.source === "hermes",
    );
    assert.equal(events.length, 4);

    // Session ids are privacy-safe opaque refs derived from the raw row id.
    const sid = (raw: string) => sessionIdFromStructuredValue("hermes", raw)!;
    const byId = new Map(events.map((event) => [event.sessionId, event]));
    const done = byId.get(sid("sess_default_done"));
    assert.ok(done);
    assert.equal(done.inputTokens, 1000);
    assert.equal(done.outputTokens, 500);
    assert.equal(done.cachedInputTokens, 200);
    assert.equal(done.cacheCreationInputTokens, 50);
    assert.equal(done.reasoningOutputTokens, 100);
    assert.equal(done.totalTokens, 1850);
    assert.equal(done.model, "hermes-agent");

    const active = byId.get(sid("sess_default_active"));
    assert.ok(active, "in-progress sessions must be read every scan");
    assert.equal(active.totalTokens, 1500);
    assert.equal(active.reasoningOutputTokens, 400);

    const personal = byId.get(sid("sess_personal_1"));
    assert.ok(personal, "profiles/*/state.db must be discovered");
    assert.equal(personal.model, "claude-sonnet-4-5");
    assert.equal(personal.totalTokens, 3800);
    assert.equal(
      byId.has(sid("sess_zero")),
      false,
      "zero-token rows are skipped",
    );

    // Session ids survive round-tripping through the source-normalized form
    // and are unique across default + profile databases.
    assert.equal(new Set(events.map((event) => event.sessionId)).size, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * Review finding: the row budget was handed to each file's parse separately,
 * but Hermes keeps one `state.db` per profile - so the documented "500,000
 * rows per source" was really "per file" and a multi-profile install could
 * multiply it by the number of profiles, escaping the memory bound the budget
 * exists to enforce. The budget is now created once per adapter scan and
 * shared by every file, and the truncation is reported once.
 */
test("the sqlite row budget is shared across a source's databases", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-budget-"));
  try {
    const hermesDir = join(root, ".hermes");
    await mkdir(join(hermesDir, "profiles", "work"), { recursive: true });
    await mkdir(join(hermesDir, "profiles", "personal"), { recursive: true });
    const epoch = Math.floor(Date.now() / 1000) - 3_600;
    const row = (id: string, index: number) => [
      id,
      "hermes-agent",
      epoch - index,
      epoch - index + 10,
      1_000 + index * 7,
      100 + index,
      0,
      0,
      0,
      1,
    ];
    const sessions = (prefix: string) => [
      row(`${prefix}-1`, 1),
      row(`${prefix}-2`, 2),
      row(`${prefix}-3`, 3),
    ];
    createHermesDb(join(hermesDir, "state.db"), sessions("default"));
    createHermesDb(
      join(hermesDir, "profiles", "work", "state.db"),
      sessions("work"),
    );
    createHermesDb(
      join(hermesDir, "profiles", "personal", "state.db"),
      sessions("personal"),
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "linux" as const,
      disablePersistentCache: true,
      maxSqliteRowsPerSource: 2,
    });
    const hermes = snapshot.sources.find(
      (source) => source.source === "hermes",
    );
    assert.ok(hermes);
    assert.ok(
      (hermes.filesParsed ?? 0) >= 2,
      `expected several profile databases, parsed ${hermes.filesParsed}`,
    );
    // Three databases x 3 rows with a per-file budget would return 6.
    assert.equal(
      hermes.events,
      2,
      "the budget must cap the whole source, not each file",
    );
    const truncations = (hermes.diagnostics ?? []).filter(
      (entry) => entry.code === "query-truncated",
    );
    assert.equal(
      truncations.length,
      1,
      "a shared budget reports once, not once per file it stopped",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** The cap every cache/share-budget test below runs the source with. */
const SHARED_BUDGET = 2;

interface SharedBudgetFixture {
  defaultDb: string;
  workDb: string;
  personalDb: string;
  sessionRow: (id: string, index: number) => unknown[];
}

/**
 * Three profile databases plus pinned mtimes. `collectAdapterFiles` walks the
 * most recently modified database first, so pinning the order makes "which
 * profile spends the budget" a property of the fixture instead of the
 * filesystem's directory order: work, then default, then personal.
 */
async function createSharedBudgetFixture(
  root: string,
  /**
   * Session rows per profile. The default gives every database three rows - one
   * more than the cap under test, so the walk is stopped by the budget; a
   * smaller count makes that profile's parse complete instead.
   */
  rowsByProfile: { work?: number; default?: number; personal?: number } = {},
): Promise<SharedBudgetFixture> {
  const hermesDir = join(root, ".hermes");
  const workDb = join(hermesDir, "profiles", "work", "state.db");
  const personalDb = join(hermesDir, "profiles", "personal", "state.db");
  const defaultDb = join(hermesDir, "state.db");
  await mkdir(join(hermesDir, "profiles", "work"), { recursive: true });
  await mkdir(join(hermesDir, "profiles", "personal"), { recursive: true });
  const epoch = Math.floor(Date.now() / 1000) - 3_600;
  const sessionRow = (id: string, index: number): unknown[] => [
    id,
    "hermes-agent",
    epoch - index,
    epoch - index + 10,
    1_000 + index * 7,
    100 + index,
    0,
    0,
    0,
    1,
  ];
  const sessions = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) =>
      sessionRow(`${prefix}-${index + 1}`, index + 1),
    );
  createHermesDb(workDb, sessions("work", rowsByProfile.work ?? 3));
  createHermesDb(defaultDb, sessions("default", rowsByProfile.default ?? 3));
  createHermesDb(personalDb, sessions("personal", rowsByProfile.personal ?? 3));
  const base = Date.now();
  const pinned = async (path: string, ageMs: number) => {
    const at = new Date(base - ageMs);
    await utimes(path, at, at);
  };
  await pinned(workDb, 60_000);
  await pinned(defaultDb, 120_000);
  await pinned(personalDb, 180_000);
  return { defaultDb, workDb, personalDb, sessionRow };
}

/**
 * Scan the fixture with the process cache enabled (the default) and the shared
 * row cap under test.
 */
async function scanSharedBudgetFixture(root: string) {
  const snapshot = await scanLocalUsage({
    homeDirectory: root,
    cacheDirectory: join(root, ".cache"),
    lookbackDays: 3650,
    platform: "linux" as const,
    maxSqliteRowsPerSource: SHARED_BUDGET,
  });
  const hermes = snapshot.sources.find((source) => source.source === "hermes");
  assert.ok(hermes, "hermes source must be reported");
  return { snapshot, hermes };
}

/**
 * P1 cache review: a cache hit returned the entry's events without paying the
 * shared budget, so a reused database no longer consumed the rows it holds and
 * the database parsed after it started from a budget that had already been
 * spent. A cold scan of two capped profiles returned 2 events; the next scan,
 * with one profile reused and the other updated, returned 4 - past the cap the
 * per-source budget exists to enforce.
 */
test("a cache-reused profile still pays the shared sqlite row budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-budget-reuse-"));
  try {
    const { workDb, personalDb, sessionRow } =
      await createSharedBudgetFixture(root);

    const cold = await scanSharedBudgetFixture(root);
    assert.equal(cold.hermes.events, SHARED_BUDGET, "the cap holds cold");

    // Nothing changed: every database is served from the cache, and the rows a
    // reused parse holds are charged back so the walk still ends at the cap.
    const warm = await scanSharedBudgetFixture(root);
    assert.equal(warm.hermes.filesReused, 3, "an unchanged scan reuses all");
    assert.equal(warm.hermes.events, SHARED_BUDGET, "the cap holds warm");

    // Update the profile the walk now reads first, so a freshly parsed database
    // and a cache-reused one share the budget exactly as in the report.
    insertHermesRows(personalDb, [
      sessionRow("personal-4", 4),
      sessionRow("personal-5", 5),
    ]);
    const afterUpdate = await scanSharedBudgetFixture(root);
    assert.equal(
      afterUpdate.hermes.events,
      SHARED_BUDGET,
      "a reused database plus an updated one must not exceed the source cap",
    );
    // The updated profile parses; the profile behind it was cached while the
    // budget was already spent, so it must be re-read under the budget it
    // actually has - and the last one may still be reused as-is.
    assert.equal(afterUpdate.hermes.filesParsed, 2);
    assert.equal(afterUpdate.hermes.filesReused, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * P1 cache review: a profile whose parse *completed* was reused without paying
 * anything either, so every cached database looked free and the source could
 * exceed its cap even with only one database left to read - the general case of
 * the same defect, with no truncation involved.
 */
test("a fully cached profile still spends the rows it holds", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-budget-whole-"));
  try {
    // "work" is read first and holds one row, so its parse completes inside the
    // cap instead of being cut off by it; "default" takes the rest.
    const { defaultDb, sessionRow } = await createSharedBudgetFixture(root, {
      work: 1,
    });

    const cold = await scanSharedBudgetFixture(root);
    assert.equal(cold.hermes.events, SHARED_BUDGET, "the cap holds cold");
    assert.equal(cold.hermes.filesParsed, 3, "every database is parsed first");

    // Nothing changed: all three are reused, the first of them whole.
    const warm = await scanSharedBudgetFixture(root);
    assert.equal(warm.hermes.filesReused, 3, "an unchanged scan reuses all");
    assert.equal(warm.hermes.events, SHARED_BUDGET, "the cap holds warm");

    // The updated profile now leads the walk and spends the whole cap, so the
    // cached whole profile behind it has nothing left to pay from.
    insertHermesRows(defaultDb, [
      sessionRow("default-4", 4),
      sessionRow("default-5", 5),
    ]);
    const afterUpdate = await scanSharedBudgetFixture(root);
    assert.equal(
      afterUpdate.hermes.events,
      SHARED_BUDGET,
      "a whole cached database must not add rows on top of a fresh parse",
    );
    assert.equal(afterUpdate.hermes.filesParsed, 2);
    assert.equal(afterUpdate.hermes.filesReused, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/**
 * P1 cache review: a profile that the walk skipped because the budget was
 * already spent was cached as "zero events" - a partial result of the *whole*
 * file set, not of that database. Deleting the database that had eaten the
 * budget left that empty result in place and the source kept reporting 0
 * events instead of re-reading a database the budget can now afford.
 */
test("a profile skipped by a spent budget is re-parsed once the budget frees up", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-budget-freed-"));
  try {
    const { workDb } = await createSharedBudgetFixture(root);

    const cold = await scanSharedBudgetFixture(root);
    assert.equal(cold.hermes.events, SHARED_BUDGET, "the cap holds cold");
    assert.equal(cold.hermes.filesParsed, 3, "every database is parsed first");

    // "work" is read first and takes the entire cap; the two profiles behind it
    // are cached with zero events and one truncation.
    await unlink(workDb);
    const afterDelete = await scanSharedBudgetFixture(root);
    assert.equal(
      afterDelete.hermes.events,
      SHARED_BUDGET,
      "the skipped profile must be re-read, not served as zero events",
    );
    assert.equal(
      afterDelete.hermes.filesParsed,
      1,
      "the profile skipped by the spent budget must be parsed again",
    );
    assert.equal(afterDelete.hermes.filesReused, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
