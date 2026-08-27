import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../database/contracts.ts";
import { DatabaseHost } from "../database/database-host.server.ts";
import { runMigrations } from "../database/migration-runner.server.ts";
import type { SnapshotEnvelope } from "../snapshot-runtime/contracts.ts";
import { createSqliteWslSnapshotRepository } from "./sqlite-wsl-snapshot-repository.server.ts";
import type { WslTopology } from "./wsl-topology.server.ts";

function versionsProvider() {
  return {
    getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
  };
}

function openHost(directory: string): DatabaseHost {
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: versionsProvider(),
  });
  runMigrations({ database: host, appVersion: "test" });
  return host;
}

function envelope(
  revision: string,
  data: WslTopology,
): SnapshotEnvelope<WslTopology> {
  return {
    schemaVersion: 1,
    revision,
    generatedAt: "2026-08-19T01:02:03.000Z",
    sourceFingerprint: "2026-08-19T01:02:03.000Z",
    status: "fresh",
    data,
    diagnostics: {
      lastAttemptAt: "2026-08-19T01:02:03.000Z",
      lastSuccessAt: "2026-08-19T01:02:03.000Z",
      warningCodes: [],
    },
  };
}

const topology: WslTopology = {
  distros: [
    { distribution: "Ubuntu", home: "/home/dev" },
    { distribution: "Debian", home: "/home/debian" },
  ],
  enumeratedAt: "2026-08-19T01:02:03.000Z",
  failed: false,
  warningCodes: [],
};

test("save→load round-trips the topology across a reopened connection", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-wsl-snap-"));
  try {
    let host = openHost(directory);
    const repository = createSqliteWslSnapshotRepository({ database: host });
    await repository.save(envelope("r1", topology));

    const sameConnection = await repository.load();
    assert.equal(sameConnection.source, "stored");
    assert.deepEqual(sameConnection.envelope.data, topology);

    // Reopen a brand-new connection on the same file: the blob survives a
    // restart because it is persisted in snapshot_blobs, not process memory.
    host.close();
    host = openHost(directory);
    const reloaded = await createSqliteWslSnapshotRepository({
      database: host,
    }).load();
    assert.deepEqual(reloaded.envelope.data, topology);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a payload larger than the 256 KB blob ceiling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-wsl-snap-big-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteWslSnapshotRepository({ database: host });
    const oversized: WslTopology = {
      distros: [{ distribution: "Huge", home: "x".repeat(300 * 1024) }],
      enumeratedAt: "2026-08-19T01:02:03.000Z",
      failed: false,
      warningCodes: [],
    };
    await assert.rejects(
      () => repository.save(envelope("r-big", oversized)),
      (error: unknown) =>
        error instanceof DatabaseError &&
        error.code === "invalid-argument" &&
        error.operation === "write",
    );
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects host Windows paths and secret-shaped payload content", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-wsl-snap-privacy-"));
  try {
    const host = openHost(directory);
    const repository = createSqliteWslSnapshotRepository({ database: host });

    const forbidden: ReadonlyArray<WslTopology> = [
      {
        distros: [{ distribution: "Host", home: "C:\\Users\\alice\\secret" }],
        enumeratedAt: null,
        failed: false,
        warningCodes: [],
      },
      {
        distros: [{ distribution: "Host", home: "sk-abc" }],
        enumeratedAt: null,
        failed: false,
        warningCodes: [],
      },
      {
        distros: [{ distribution: "Host", home: "ghp_abc" }],
        enumeratedAt: null,
        failed: false,
        warningCodes: [],
      },
    ];
    for (const data of forbidden) {
      await assert.rejects(
        () => repository.save(envelope("r-host", data)),
        (error: unknown) =>
          error instanceof DatabaseError &&
          error.code === "invalid-argument" &&
          error.operation === "write",
      );
    }

    // Legitimate Linux home paths inside WSL distros still persist (the guard
    // must not apply the platform's POSIX-root rules to `/home/dev`).
    await repository.save(envelope("r-linux", topology));
    const reloaded = await repository.load();
    assert.deepEqual(reloaded.envelope.data, topology);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps the head plus one previous generation and clears on demand", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-wsl-snap-gen-"));
  try {
    const host = openHost(directory);
    let sequence = 0;
    const repository = createSqliteWslSnapshotRepository({
      database: host,
      now: () => 1_700_000_000_000 + sequence,
      createId: () => `wsl-${++sequence}`,
    });
    await repository.save(envelope("r1", topology));
    await repository.save(envelope("r2", topology));
    await repository.save(envelope("r3", topology));

    const count = (): number =>
      Number(
        host
          .prepare(
            "SELECT COUNT(*) AS n FROM snapshot_generations WHERE domain = 'wsl'",
          )
          .get()!.n,
      );
    assert.equal(count(), 2, "commitGeneration retains head + one prior");
    assert.equal((await repository.load()).envelope.revision, "r3");

    await repository.clear();
    assert.equal(count(), 0);
    const cleared = await repository.load();
    assert.equal(cleared.source, "default");
    assert.equal(cleared.envelope.status, "empty");
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot_blobs only accepts valid JSON (SQL CHECK) and bounded payloads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-wsl-snap-json-"));
  try {
    const host = openHost(directory);
    host
      .prepare(
        `INSERT INTO snapshot_generations (snapshot_id, domain, schema_version, revision, status, created_at_ms)
         VALUES (?, 'wsl', 1, ?, 'fresh', 0)`,
      )
      .run("g1", "r1");

    assert.throws(
      () =>
        host
          .prepare(
            "INSERT INTO snapshot_blobs (snapshot_id, payload_json, payload_bytes) VALUES (?, ?, ?)",
          )
          .run("g1", "{not json", 9),
      (error: unknown) =>
        error instanceof DatabaseError && error.code === "constraint-violation",
    );
    host
      .prepare(
        "INSERT INTO snapshot_blobs (snapshot_id, payload_json, payload_bytes) VALUES (?, ?, ?)",
      )
      .run("g1", "{}", 2);
    host.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
