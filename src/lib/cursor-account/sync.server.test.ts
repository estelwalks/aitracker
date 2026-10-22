import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readCursorUsageCache, writeCursorUsageCache } from "./cache.server.ts";
import { CURSOR_ACCOUNT_ERROR_CODES } from "./client.server.ts";
import { resolveCursorAccountPaths } from "./paths.server.ts";
import {
  readCursorAccountStatus,
  syncCursorAccountUsage,
} from "./sync.server.ts";

const HEADER =
  "Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

function csv(rows: readonly string[]): string {
  return [HEADER, ...rows].join("\n");
}

interface Fixture {
  readonly root: string;
  readonly paths: ReturnType<typeof resolveCursorAccountPaths>;
}

async function createHome(signedIn: boolean): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-sync-"));
  const paths = resolveCursorAccountPaths({
    homeDirectory: root,
    platform: "macos",
  });
  await mkdir(paths.appDir, { recursive: true });
  if (signedIn) {
    await mkdir(join(paths.stateDatabasePath, ".."), { recursive: true });
    const database = new DatabaseSync(paths.stateDatabasePath);
    database.exec("CREATE TABLE ItemTable (key TEXT, value TEXT) STRICT");
    database
      .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
      .run(
        "cursorAuth/accessToken",
        "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdXRoMHx1c2VyX1RPS0VOMTIzIn0.sig",
      );
    database.close();
    await mkdir(join(root, ".cursor"), { recursive: true });
    await writeFile(
      paths.cliConfigPath,
      JSON.stringify({ authInfo: { authId: "auth0|user_TOKEN123" } }),
    );
  }
  return { root, paths };
}

test("a disabled collector never reads the session or connects", async () => {
  const fixture = await createHome(true);
  try {
    let fetched = 0;
    const result = await syncCursorAccountUsage({
      homeDirectory: fixture.root,
      platform: "macos",
      enabled: false,
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("");
      }) as typeof fetch,
    });
    assert.equal(result.status, "disabled");
    assert.equal(result.installed, true);
    assert.equal(fetched, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("reports a missing Cursor install without a request", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-absent-"));
  try {
    let fetched = 0;
    const result = await syncCursorAccountUsage({
      homeDirectory: root,
      platform: "macos",
      enabled: true,
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("");
      }) as typeof fetch,
    });
    assert.equal(result.status, "not-installed");
    assert.equal(fetched, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a signed-out Cursor is reported without a request", async () => {
  const fixture = await createHome(false);
  try {
    let fetched = 0;
    const result = await syncCursorAccountUsage({
      homeDirectory: fixture.root,
      platform: "macos",
      enabled: true,
      fetchImpl: (async () => {
        fetched += 1;
        return new Response("");
      }) as typeof fetch,
    });
    assert.equal(result.status, "not-signed-in");
    assert.equal(fetched, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("writes the fetched export into the scanner cache", async () => {
  const fixture = await createHome(true);
  try {
    const result = await syncCursorAccountUsage({
      homeDirectory: fixture.root,
      platform: "macos",
      enabled: true,
      now: () => Date.parse("2026-10-21T12:00:00.000Z"),
      fetchImpl: (async () =>
        new Response(
          csv([
            '"2026-10-21T06:56:12.521Z","Included","composer-2-fast","No","160000","159990","578207","2055","740252","0.49"',
            '"2026-10-20T10:00:00.000Z","Included","auto","Yes","0","1000","0","500","1500","0.02"',
          ]),
        )) as typeof fetch,
    });
    assert.equal(result.status, "synced");
    assert.equal(result.records, 2);
    assert.equal(result.cachedRecords, 2);
    assert.equal(result.syncedAt, "2026-10-21T12:00:00.000Z");
    const cache = await readCursorUsageCache(fixture.paths.cachePath);
    assert.ok(cache);
    assert.equal(cache.events.length, 2);
    assert.equal(cache.events[0].session_id, "day-2026-10-20");
    assert.equal(cache.events[1].usage.output_tokens, 2055);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a fresh export replaces its own window and keeps older history", async () => {
  const fixture = await createHome(true);
  try {
    await mkdir(fixture.paths.cacheDirectory, { recursive: true });
    await writeCursorUsageCache(
      fixture.paths.cachePath,
      [
        {
          timestamp: "2026-09-01T00:00:00.000Z",
          session_id: "day-2026-09-01",
          model: "composer-2-fast",
          project: "cursor-account",
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 5,
            reasoning_output_tokens: 0,
            total_tokens: 15,
          },
        },
        {
          timestamp: "2026-10-21T06:56:12.521Z",
          session_id: "day-2026-10-21",
          model: "composer-2-fast",
          project: "cursor-account",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 2,
          },
        },
      ],
      "2026-10-21T11:00:00.000Z",
    );

    const result = await syncCursorAccountUsage({
      homeDirectory: fixture.root,
      platform: "macos",
      enabled: true,
      fetchImpl: (async () =>
        new Response(
          csv([
            '"2026-10-21T06:56:12.521Z","Included","composer-2-fast","No","160000","159990","578207","2055","740252","0.49"',
          ]),
        )) as typeof fetch,
    });
    assert.equal(result.status, "synced");
    const cache = await readCursorUsageCache(fixture.paths.cachePath);
    assert.ok(cache);
    assert.equal(
      cache.events.length,
      2,
      "the in-window row is corrected and the older row survives",
    );
    assert.equal(cache.events[0].timestamp, "2026-09-01T00:00:00.000Z");
    assert.equal(cache.events[1].usage.output_tokens, 2055);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("an expired session is reported and leaves the cache untouched", async () => {
  const fixture = await createHome(true);
  try {
    const result = await syncCursorAccountUsage({
      homeDirectory: fixture.root,
      platform: "macos",
      enabled: true,
      fetchImpl: (async () =>
        new Response("", { status: 401 })) as typeof fetch,
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, CURSOR_ACCOUNT_ERROR_CODES.signInExpired);
    assert.equal(
      await readCursorUsageCache(fixture.paths.cachePath),
      null,
      "a failed sync must not create an empty cache",
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("status describes install, sign-in and cache without connecting", async () => {
  const fixture = await createHome(true);
  try {
    const before = await readCursorAccountStatus({
      homeDirectory: fixture.root,
      platform: "macos",
    });
    assert.equal(before.installed, true);
    assert.equal(before.signedIn, true);
    assert.equal(before.cachedRecords, 0);

    await mkdir(fixture.paths.cacheDirectory, { recursive: true });
    await writeCursorUsageCache(
      fixture.paths.cachePath,
      [
        {
          timestamp: "2026-10-21T06:56:12.521Z",
          session_id: "day-2026-10-21",
          model: "auto",
          project: "cursor-account",
          usage: {
            input_tokens: 1,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 1,
            reasoning_output_tokens: 0,
            total_tokens: 2,
          },
        },
      ],
      "2026-10-21T12:00:00.000Z",
    );
    const after = await readCursorAccountStatus({
      homeDirectory: fixture.root,
      platform: "macos",
    });
    assert.equal(after.cachedRecords, 1);
    assert.equal(after.syncedAt, "2026-10-21T12:00:00.000Z");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
