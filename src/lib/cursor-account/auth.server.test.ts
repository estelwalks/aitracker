import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  normalizeCursorAccountSubject,
  readCursorAccountSession,
  readCursorJwtSubject,
} from "./auth.server.ts";
import { resolveCursorAccountPaths } from "./paths.server.ts";

function stateDb(accessToken: string): (path: string) => Promise<void> {
  return async (path: string) => {
    await mkdir(join(path, ".."), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec("CREATE TABLE ItemTable (key TEXT, value TEXT) STRICT");
    database
      .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
      .run("cursorAuth/accessToken", accessToken);
    database.close();
  };
}

function jwt(subject: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url",
  );
  return `${header}.${payload}.signature`;
}

test("native accounts strip the auth0 prefix from the cookie subject", () => {
  assert.equal(
    normalizeCursorAccountSubject("auth0|user_ABC123"),
    "user_ABC123",
  );
  assert.equal(
    normalizeCursorAccountSubject("google-oauth2|1029384756"),
    "google-oauth2|1029384756",
  );
  assert.equal(normalizeCursorAccountSubject("github|42"), "github|42");
  assert.equal(normalizeCursorAccountSubject("oidc|abc"), "oidc|abc");
  assert.equal(normalizeCursorAccountSubject("unknown-provider|x"), null);
  assert.equal(normalizeCursorAccountSubject(""), null);
  assert.equal(normalizeCursorAccountSubject(undefined), null);
});

test("reads the access token and CLI subject into a cursor.com cookie", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-auth-"));
  try {
    const paths = resolveCursorAccountPaths({
      homeDirectory: root,
      platform: "macos",
    });
    await stateDb("eyJhbGciOiJub25lIn0.eyJzdWIiOiJhdXRoMHx1c2VyX0FCQyJ9.sig")(
      paths.stateDatabasePath,
    );
    await mkdir(join(root, ".cursor"), { recursive: true });
    await writeFile(
      paths.cliConfigPath,
      JSON.stringify({ authInfo: { authId: "auth0|user_ABC" } }),
    );

    const session = await readCursorAccountSession(paths);
    assert.ok(session);
    assert.equal(session.userId, "user_ABC");
    assert.equal(
      session.cookie,
      "WorkosCursorSessionToken=user_ABC%3A%3AeyJhbGciOiJub25lIn0.eyJzdWIiOiJhdXRoMHx1c2VyX0FCQyJ9.sig",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("falls back to the JWT subject when the CLI config is absent", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-jwt-"));
  try {
    const paths = resolveCursorAccountPaths({
      homeDirectory: root,
      platform: "macos",
    });
    await stateDb(jwt("google-oauth2|1029384756"))(paths.stateDatabasePath);
    const session = await readCursorAccountSession(paths);
    assert.ok(session);
    assert.equal(session.userId, "google-oauth2|1029384756");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("returns null when Cursor never stored a token", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-cursor-empty-"));
  try {
    const paths = resolveCursorAccountPaths({
      homeDirectory: root,
      platform: "macos",
    });
    assert.equal(await readCursorAccountSession(paths), null);
    await mkdir(join(paths.stateDatabasePath, ".."), { recursive: true });
    const database = new DatabaseSync(paths.stateDatabasePath);
    database.exec("CREATE TABLE ItemTable (key TEXT, value TEXT) STRICT");
    database.close();
    assert.equal(await readCursorAccountSession(paths), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("decodes the JWT subject without trusting an unknown provider", () => {
  assert.equal(readCursorJwtSubject(jwt("auth0|user_XYZ")), "user_XYZ");
  assert.equal(readCursorJwtSubject(jwt("provider|x")), null);
  assert.equal(readCursorJwtSubject("not-a-jwt"), null);
});
