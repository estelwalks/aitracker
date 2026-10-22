import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { scanLocalSessions } from "./scanner.server.ts";

/**
 * Cursor keeps Agent/Composer conversations in the IDE state database. These
 * fixtures are anonymized structural samples: the scan must surface one
 * read-only session per composer (title/model/turns/times), never prompt text.
 */

const START = Date.parse("2026-10-21T10:00:00.000Z");
const USER_AT = "2026-10-21T10:00:05.000Z";
const REPLY_AT = "2026-10-21T10:00:30.000Z";
const END = Date.parse("2026-10-21T10:01:00.000Z");
const PROJECT_PATH = "/fixtures/project";

interface FixtureComposer {
  readonly id: string;
  readonly name: string;
  readonly isDraft: boolean;
  readonly isSubagent: boolean;
  readonly workspaceId: string;
}

function cursorAppDirectory(home: string): string {
  if (process.platform === "win32") {
    return join(home, "AppData", "Roaming", "Cursor");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor");
  }
  return join(home, ".config", "Cursor");
}

function stateDatabasePath(home: string): string {
  return join(cursorAppDirectory(home), "User", "globalStorage", "state.vscdb");
}

function composerDataJson(composer: FixtureComposer): string {
  return JSON.stringify({
    composerId: composer.id,
    name: composer.name,
    createdAt: START,
    lastUpdatedAt: END,
    modelConfig: { modelName: "grok-4.6" },
    workspaceIdentifier: {
      id: composer.workspaceId,
      uri: { fsPath: PROJECT_PATH },
    },
    fullConversationHeadersOnly: [
      {
        bubbleId: "bubble-user",
        type: 1,
        createdAt: USER_AT,
        grouping: { textPreview: "Fix the login redirect bug" },
      },
      {
        bubbleId: "bubble-assistant",
        type: 2,
        createdAt: REPLY_AT,
        grouping: { isRenderable: true },
      },
    ],
  });
}

function insertHeader(database: DatabaseSync, composer: FixtureComposer): void {
  database
    .prepare(
      `INSERT INTO composerHeaders
         (composerId, workspaceId, createdAt, lastUpdatedAt, isArchived,
          isSubagent, recency, checkpointAt, subagentTypeName, value)
       VALUES (?, ?, ?, ?, 0, ?, ?, NULL, '', ?)`,
    )
    .run(
      composer.id,
      composer.workspaceId,
      START,
      END,
      composer.isSubagent ? 1 : 0,
      END,
      JSON.stringify({
        name: composer.name,
        isDraft: composer.isDraft,
        createdAt: START,
        lastUpdatedAt: END,
        workspaceIdentifier: { id: composer.workspaceId },
      }),
    );
}

async function createStateDatabase(
  home: string,
  options: { readonly withHeadersTable: boolean },
): Promise<void> {
  const databasePath = stateDatabasePath(home);
  await mkdir(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  try {
    database.exec("CREATE TABLE ItemTable (key TEXT, value TEXT)");
    database.exec(
      "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT) STRICT",
    );
    const main: FixtureComposer = {
      id: "composer-1",
      name: "Fix login redirect",
      isDraft: false,
      isSubagent: false,
      workspaceId: "workspace-1",
    };
    database
      .prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)")
      .run(`composerData:${main.id}`, composerDataJson(main));

    if (!options.withHeadersTable) return;
    database.exec(`CREATE TABLE composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      recency INTEGER,
      checkpointAt INTEGER,
      subagentTypeName TEXT,
      value TEXT
    ) STRICT`);
    insertHeader(database, main);
    // A draft and a subagent never become session rows.
    insertHeader(database, { ...main, id: "composer-draft", isDraft: true });
    insertHeader(database, {
      ...main,
      id: "composer-subagent",
      isSubagent: true,
    });
  } finally {
    database.close();
  }
}

async function withTempHome(
  run: (home: string) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), "aitracker-cursor-session-"));
  // Pin the Linux config base so the fixture and the registry plan agree.
  const previousXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  try {
    await run(home);
  } finally {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    await rm(home, { recursive: true, force: true });
  }
}

test("Cursor: a composer becomes one read-only session with turn metadata", async () => {
  await withTempHome(async (home) => {
    await createStateDatabase(home, { withHeadersTable: true });
    const summary = await scanLocalSessions({ homeDirectory: home });
    const cursor = summary.sessions.filter(
      (session) => session.source === "cursor",
    );

    assert.equal(cursor.length, 1);
    const session = cursor[0]!;
    assert.equal(session.sessionId, "composer-1");
    assert.equal(session.title, "Fix login redirect");
    assert.equal(session.model, "grok-4.6");
    assert.equal(session.turns, 1);
    assert.equal(session.projectRef, PROJECT_PATH);
    assert.equal(session.projectKey, basename(PROJECT_PATH));
    assert.equal(session.startedAt, USER_AT);
    assert.equal(session.endedAt, new Date(END).toISOString());
    assert.equal(session.totals.totalTokens, 0);
    assert.equal(session.resumeSafe, false);
    assert.equal(session.resumeCommand, null);
    // The prompt body never becomes the title; only the composer name does.
    assert.notEqual(session.title, "Fix the login redirect bug");
  });
});

test("Cursor: older builds without composerHeaders still list composers", async () => {
  await withTempHome(async (home) => {
    await createStateDatabase(home, { withHeadersTable: false });
    const summary = await scanLocalSessions({ homeDirectory: home });
    const cursor = summary.sessions.filter(
      (session) => session.source === "cursor",
    );
    assert.equal(cursor.length, 1);
    assert.equal(cursor[0]!.title, "Fix login redirect");
  });
});

test("Cursor: a missing state database yields no Cursor sessions", async () => {
  await withTempHome(async (home) => {
    const summary = await scanLocalSessions({ homeDirectory: home });
    assert.equal(
      summary.sessions.filter((session) => session.source === "cursor").length,
      0,
    );
  });
});
