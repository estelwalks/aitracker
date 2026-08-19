import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSnapshot, documentFromPublic, indexVersion } from "../domain.ts";
import { createSqliteSearchIndexRepository } from "./sqlite-search-index-repository.server.ts";

function openHost(directory: string): DatabaseHost {
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  return host;
}

test("upsert is idempotent on the (type, source_ref) identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tt-search-repo-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });
    const documents = [
      documentFromPublic({
        id: "agent:codex",
        type: "agent",
        sourceRef: "agent.codex",
        title: "Codex",
        textSummary: "AI coding assistant",
      }),
    ];
    const snapshot = createSnapshot(documents, "2026-08-07T00:00:00.000Z");
    assert.equal((await repository.write(snapshot)).ok, true);
    assert.equal((await repository.write(snapshot)).ok, true);

    assert.equal(
      Number(
        host.prepare("SELECT COUNT(*) AS n FROM search_documents").get()!.n,
      ),
      1,
    );
    const read = await repository.read();
    assert.equal(read.ok, true);
    assert.equal(read.value.documents.length, 1);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("write is a full rebuild and removes rows absent from the snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tt-search-repo-rebuild-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });

    const first = createSnapshot(
      [
        documentFromPublic({
          id: "agent:codex",
          type: "agent",
          sourceRef: "agent.codex",
          title: "Codex",
        }),
        documentFromPublic({
          id: "skill:search",
          type: "skill",
          sourceRef: "skill.search",
          title: "Search skill",
        }),
      ],
      "2026-08-07T00:00:00.000Z",
    );
    await repository.write(first);

    const second = createSnapshot(
      [
        documentFromPublic({
          id: "skill:search",
          type: "skill",
          sourceRef: "skill.search",
          title: "Search skill updated",
        }),
      ],
      "2026-08-07T00:01:00.000Z",
    );
    await repository.write(second);

    const read = await repository.read();
    assert.equal(read.ok, true);
    assert.deepEqual(
      read.value.documents.map((document) => document.id),
      ["skill:search"],
    );
    assert.equal(read.value.documents[0]?.title, "Search skill updated");
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("read reconstructs a snapshot whose version matches the domain fingerprint", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tt-search-repo-version-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });
    const documents = [
      documentFromPublic({
        id: "knowledge:one",
        type: "knowledge",
        sourceRef: "knowledge.one",
        title: "Knowledge",
        textSummary: "offline index",
        tags: ["memory"],
      }),
    ];
    await repository.write(
      createSnapshot(documents, "2026-08-07T00:00:00.000Z"),
    );

    const read = await repository.read();
    assert.equal(read.ok, true);
    assert.equal(read.value.version, indexVersion(read.value.documents));
    assert.equal(read.value.documents.length, 1);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
