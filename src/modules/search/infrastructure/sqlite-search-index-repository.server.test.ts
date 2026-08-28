import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import type { SearchDocument, SearchIndexSnapshot } from "../contracts.ts";
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
  const directory = mkdtempSync(join(tmpdir(), "aitracker-search-repo-"));
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
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-search-repo-rebuild-"),
  );
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
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-search-repo-version-"),
  );
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

test("P1-9: forbidden private content is skipped, never fatal to the write", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-search-repo-privacy-"),
  );
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });

    const base: SearchDocument = {
      id: "agent:bad",
      type: "agent",
      sourceRef: "agent.bad",
      title: "Safe title",
      tags: [],
      textSummary: "safe summary",
      freshness: "fresh",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };
    const cases: ReadonlyArray<Partial<SearchDocument>> = [
      { title: "C:\\Users\\alice\\secret.txt" },
      { title: "/Users/alice/secret.txt" },
      { textSummary: "Bearer eyJhbGciOiJIUzI1NiJ9.abc.def" },
      { textSummary: "API Key: sk-abcdefghijklmnopqrstuvwxyz123456" },
      { textSummary: "rm -rf /tmp/x" },
    ];

    for (const patch of cases) {
      const document: SearchDocument = { ...base, ...patch };
      const snapshot: SearchIndexSnapshot = {
        schemaVersion: 1,
        version: "search-v1-00000000",
        generatedAt: "2026-08-07T00:00:00.000Z",
        stale: false,
        documents: [document],
      };
      const result = await repository.write(snapshot);
      assert.equal(
        result.ok,
        true,
        `${JSON.stringify(patch)} must be skipped, not fatal`,
      );
    }

    // Every rejected write skipped its single document → no rows persisted.
    assert.equal(
      Number(
        host.prepare("SELECT COUNT(*) AS n FROM search_documents").get()!.n,
      ),
      0,
    );
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("P1-9: a mixed write keeps the valid documents and drops only the bad one", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-search-repo-mixed-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });
    const good = documentFromPublic({
      id: "agent:good",
      type: "agent",
      sourceRef: "agent.good",
      title: "Good agent",
      textSummary: "safe",
    });
    const bad = documentFromPublic({
      id: "agent:bad",
      type: "agent",
      sourceRef: "agent.bad",
      title: "/Users/alice/secret.txt",
      textSummary: "unsafe",
    });
    const result = await repository.write(
      createSnapshot([good, bad], "2026-08-07T00:00:00.000Z"),
    );
    assert.equal(result.ok, true);
    const read = await repository.read();
    assert.equal(read.ok, true);
    assert.deepEqual(
      read.value.documents.map((document) => document.id),
      ["agent:good"],
    );
    assert.equal(read.value.skipped, 0); // the bad doc never reached storage
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("P1-9: read() returns remaining documents instead of failing on a bad stored row", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-search-repo-read-skip-"),
  );
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });
    // Persist one valid + one privacy-violating row directly (as if a bad
    // record predated the guard fix).
    await repository.write(
      createSnapshot(
        [
          documentFromPublic({
            id: "agent:good",
            type: "agent",
            sourceRef: "agent.good",
            title: "Good agent",
            textSummary: "safe",
          }),
        ],
        "2026-08-07T00:00:00.000Z",
      ),
    );
    host
      .prepare(
        `INSERT INTO search_documents
        (document_id, type, source_ref, title, tags_json, text_summary, freshness, updated_at_ms, source_revision)
        VALUES ('agent:bad', 'agent', 'agent.bad', '/Users/alice/secret.txt', '[]', 'unsafe', 'fresh', ?, NULL)`,
      )
      .run(Date.parse("2026-08-07T00:00:00.000Z"));

    const read = await repository.read();
    assert.equal(read.ok, true);
    assert.deepEqual(
      read.value.documents.map((document) => document.id),
      ["agent:good"],
    );
    assert.equal(read.value.skipped, 1);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("P2-13: full rebuild with more than 500 documents never exceeds SQLite placeholders", async () => {
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-search-repo-chunked-"),
  );
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });

    const documents = Array.from({ length: 1200 }, (_, index) =>
      documentFromPublic({
        id: `agent:doc-${index}`,
        type: "agent",
        sourceRef: `agent.doc-${index}`,
        title: `Agent ${index}`,
        textSummary: `summary ${index}`,
      }),
    );
    const first = await repository.write(
      createSnapshot(documents, "2026-08-07T00:00:00.000Z"),
    );
    assert.equal(first.ok, true);
    assert.equal(
      Number(
        host.prepare("SELECT COUNT(*) AS n FROM search_documents").get()!.n,
      ),
      1200,
    );

    // Rebuild with a subset: the rows absent from the new snapshot must be
    // deleted in chunks (the old single NOT IN with 1200 placeholders would
    // still fit, so exercise a genuinely large set twice to cross chunks).
    const kept = documents.filter((_, index) => index < 600 || index >= 1100);
    const second = await repository.write(
      createSnapshot(kept, "2026-08-07T00:01:00.000Z"),
    );
    assert.equal(second.ok, true);
    assert.equal(
      Number(
        host.prepare("SELECT COUNT(*) AS n FROM search_documents").get()!.n,
      ),
      700,
    );
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects host paths and secret-shaped refs but allows opaque references", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-search-repo-ref-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteSearchIndexRepository({ database: host });

    const base: SearchDocument = {
      id: "agent:ok",
      type: "agent",
      sourceRef: "agent.ok",
      title: "Safe title",
      tags: [],
      textSummary: "safe summary",
      freshness: "fresh",
      updatedAt: "2026-08-07T00:00:00.000Z",
    };
    // These bypass the domain `assertSearchDocument` shape check (they are
    // within the SAFE_ID/SAFE_SOURCE character set) so the repository's
    // opaque-reference guard is exercised directly and rejects the write.
    const rejected: ReadonlyArray<Partial<SearchDocument>> = [
      { sourceRef: "C:/Users/alice/secret.txt" },
      { sourceRef: "sk-abc" },
      { sourceRef: "ghp_abc" },
      { id: "sk-abc" },
    ];
    for (const patch of rejected) {
      const snapshot: SearchIndexSnapshot = {
        schemaVersion: 1,
        version: "search-v1-00000000",
        generatedAt: "2026-08-07T00:00:00.000Z",
        stale: false,
        documents: [{ ...base, ...patch }],
      };
      const result = await repository.write(snapshot);
      assert.equal(
        result.ok,
        false,
        `${JSON.stringify(patch)} must be rejected`,
      );
    }

    // A POSIX absolute-path sourceRef violates the domain SAFE_SOURCE shape
    // itself, so it is skipped by the canonicalizer instead of rejected — the
    // document is never persisted either way.
    const skipped = await repository.write({
      schemaVersion: 1,
      version: "search-v1-00000000",
      generatedAt: "2026-08-07T00:00:00.000Z",
      stale: false,
      documents: [{ ...base, sourceRef: "/Users/alice/secret.txt" }],
    });
    assert.equal(skipped.ok, true);

    // Legitimate `type:id` / `type:a/b` opaque references still persist.
    const allowed = createSnapshot(
      [
        {
          ...base,
          id: "session:abc123",
          type: "session",
          sourceRef: "session.abc123",
        },
        {
          ...base,
          id: "skill:market",
          type: "skill",
          sourceRef: "skill:market/repo",
        },
      ],
      "2026-08-07T00:00:00.000Z",
    );
    const allowedResult = await repository.write(allowed);
    assert.equal(allowedResult.ok, true);
    assert.equal(
      Number(
        host.prepare("SELECT COUNT(*) AS n FROM search_documents").get()!.n,
      ),
      2,
    );
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
