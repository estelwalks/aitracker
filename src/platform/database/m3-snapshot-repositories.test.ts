import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildLocalUsageSnapshot } from "../../lib/local-usage/aggregate.ts";
import { createSqliteClassificationIndexRepository } from "../../modules/dashboard/sqlite-classification-index.server.ts";
import { createSqliteSessionSnapshotRepository } from "../../modules/sessions/infrastructure/sqlite-session-snapshot-repository.server.ts";
import { createSqliteSkillSnapshotRepository } from "../../modules/skill-catalog/infrastructure/sqlite-skill-snapshot-repository.server.ts";
import { createSqliteUsageSnapshotRepository } from "../../modules/usage/infrastructure/sqlite-usage-snapshot-repository.server.ts";
import { createSqliteInstallationSnapshotRepository } from "../discovery/sqlite-installation-snapshot-repository.server.ts";
import type { SnapshotEnvelope } from "../snapshot-runtime/contracts.ts";
import { DatabaseHost } from "./database-host.server.ts";
import { runMigrations } from "./migration-runner.server.ts";

function stringifySqliteRows(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function openDatabase(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-m3-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "m3-test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

function envelope<T>(revision: string, data: T): SnapshotEnvelope<T> {
  return {
    schemaVersion: 1,
    revision,
    generatedAt: "2026-08-19T01:02:03.000Z",
    sourceFingerprint: `fp-${revision}`,
    status: "fresh",
    data,
    diagnostics: {
      lastAttemptAt: "2026-08-19T01:02:03.000Z",
      lastSuccessAt: "2026-08-19T01:02:03.000Z",
      warningCodes: [],
    },
  };
}

test("usage aggregate generation is atomic and never reads or writes legacy events", async (t) => {
  const database = openDatabase(t);
  let sequence = 0;
  const repository = createSqliteUsageSnapshotRepository({
    database,
    hmacKey: "test-installation-key",
    now: () => 1_700_000_000_000 + sequence,
    createId: () => `usage-${++sequence}`,
  });
  const event = {
    source: "codex" as const,
    timestamp: "2026-08-19T01:00:00.000Z",
    model: "gpt-test",
    project: "C:\\Users\\alice\\secret-repo",
    sessionId: "raw-session-id",
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheCreationInputTokens: 0,
    outputTokens: 5,
    reasoningOutputTokens: 1,
    totalTokens: 18,
    context: {
      skills: [{ name: "review", calls: 1 }],
      commands: [
        {
          kind: "exec_command" as const,
          executable: "C:\\Windows\\System32\\cmd.exe",
          safeSignature: "cmd:build",
          duration: "under-1s" as const,
          outputSize: "under-1k" as const,
          exitStatus: "success" as const,
          calls: 1,
        },
      ],
    },
  };
  await createSqliteClassificationIndexRepository({
    database,
    hmacKey: "test-installation-key",
  }).commit([
    {
      ref: event.project,
      kind: "quick-conversation",
      label: "quick-conversation",
      classifiedAt: "2026-08-19T01:01:00.000Z",
      fingerprint: null,
    },
  ]);
  const data = {
    generatedAt: "2026-08-19T01:02:03.000Z",
    mode: "real" as const,
    sources: [
      {
        source: "codex" as const,
        available: true,
        filesConsidered: 1,
        filesRead: 1,
        filesReused: 0,
        filesParsed: 1,
        malformedLines: 0,
        events: 1,
      },
    ],
    events: 1,
    totals: {
      events: 1,
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 0,
      outputTokens: 5,
      reasoningOutputTokens: 1,
      totalTokens: 18,
    },
    bySource: [],
    byModel: [],
    byProject: [],
    daily: [],
    details: [event],
    recent: [event],
  };
  await repository.save(envelope("r1", data));

  const persisted = database
    .prepare(
      "SELECT project_ref_hash,project_label,project_kind FROM usage_aggregate_buckets",
    )
    .get()!;
  assert.notEqual(persisted.project_ref_hash, event.project);
  assert.equal(persisted.project_label, "quick-conversation");
  assert.equal(persisted.project_kind, "quick-conversation");
  assert.equal(
    Number(
      database
        .prepare("SELECT count(*) AS count FROM usage_tracker_buckets")
        .get()!.count,
    ),
    3,
  );
  // Migration 0002 (P2-14) removed the legacy event tables entirely; the
  // aggregate repository must never recreate them.
  for (const legacy of ["usage_events", "usage_event_command_stats"]) {
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(legacy),
      undefined,
      `legacy table ${legacy} must not exist after migration 0002`,
    );
  }
  assert.ok(
    !stringifySqliteRows(
      database.prepare("SELECT * FROM usage_aggregate_buckets").all(),
    ).includes("C:\\Users"),
  );
  const hydrated = await repository.load();
  assert.equal(hydrated.envelope.data?.events, 1);
  assert.equal(hydrated.envelope.data?.totals.totalTokens, 18);
  assert.equal(hydrated.envelope.data?.details.length, 0);
  assert.equal(hydrated.envelope.data?.aggregateBuckets?.length, 1);
  assert.equal(hydrated.envelope.data?.trackerBuckets?.length, 3);
  assert.equal(
    hydrated.envelope.data?.aggregateBuckets?.[0]?.projectKind,
    "quick-conversation",
  );

  await assert.rejects(repository.save(envelope("r1", data)));
  assert.equal(
    database
      .prepare(
        "SELECT revision FROM snapshot_generations g JOIN snapshot_heads h ON h.snapshot_id=g.snapshot_id WHERE h.domain='usage'",
      )
      .get()!.revision,
    "r1",
  );
  assert.equal(
    Number(
      database
        .prepare(
          "SELECT count(*) AS count FROM snapshot_generations WHERE domain='usage'",
        )
        .get()!.count,
    ),
    1,
  );
});

test("usage aggregate keeps safe labels for unknown task-like project refs", async (t) => {
  const database = openDatabase(t);
  const hmacKey = "test-installation-key";
  const project = "Standalone AiPy task";
  await createSqliteClassificationIndexRepository({ database, hmacKey }).commit(
    [
      {
        ref: project,
        kind: "unknown",
        label: "unknown",
        classifiedAt: "2026-08-19T01:01:00.000Z",
        fingerprint: null,
      },
    ],
  );
  const repository = createSqliteUsageSnapshotRepository({ database, hmacKey });
  const snapshot = buildLocalUsageSnapshot(
    [
      {
        source: "aipy",
        timestamp: "2026-08-19T01:00:00.000Z",
        model: "auto",
        project,
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 0,
        totalTokens: 15,
      },
    ],
    [],
    new Date("2026-08-19T01:02:00.000Z"),
  );

  await repository.save(envelope("aipy-title", snapshot));

  const persisted = database
    .prepare("SELECT project_label, project_kind FROM usage_aggregate_buckets")
    .get();
  assert.equal(persisted?.project_label, project);
  assert.equal(persisted?.project_kind, "unknown");
  const loaded = await repository.load();
  assert.equal(
    loaded.envelope.data?.aggregateBuckets?.[0]?.projectLabel,
    project,
  );
});

test("same-name projects keep distinct HMAC identities and persisted classification", async (t) => {
  const database = openDatabase(t);
  const hmacKey = "same-name-project-test-key";
  const projects = ["/Users/alice/a/shared", "/Users/alice/b/shared"];
  const classifications = createSqliteClassificationIndexRepository({
    database,
    hmacKey,
  });
  await classifications.commit(
    projects.map((ref) => ({
      ref,
      kind: "workspace" as const,
      label: "shared",
      classifiedAt: "2026-08-19T01:00:00.000Z",
      fingerprint: null,
    })),
  );
  const snapshot = buildLocalUsageSnapshot(
    projects.map((project, index) => ({
      source: "codex" as const,
      timestamp: `2026-08-19T01:0${index}:00.000Z`,
      model: "gpt-test",
      project,
      sessionId: `session_${index}`,
      inputTokens: 10,
      cachedInputTokens: 2,
      cacheCreationInputTokens: 1,
      outputTokens: 5,
      reasoningOutputTokens: 1,
      totalTokens: 19,
      context: { skills: [{ name: "review", calls: 1 }] },
    })),
    [],
    new Date("2026-08-19T02:00:00.000Z"),
  );
  const repository = createSqliteUsageSnapshotRepository({
    database,
    hmacKey,
    createId: () => "same-name-snapshot",
  });
  await repository.save(envelope("same-name-r1", snapshot));

  const projectRows = database
    .prepare(
      `SELECT project_ref_hash, project_label, project_kind
       FROM usage_aggregate_buckets ORDER BY project_ref_hash`,
    )
    .all();
  assert.equal(projectRows.length, 2);
  assert.equal(new Set(projectRows.map((row) => row.project_ref_hash)).size, 2);
  assert.deepEqual(
    projectRows.map((row) => [row.project_label, row.project_kind]),
    [
      ["shared", "workspace"],
      ["shared", "workspace"],
    ],
  );
  const trackerProjects = database
    .prepare(
      `SELECT entity_key, entity_label, project_kind
       FROM usage_tracker_buckets WHERE dimension='project'`,
    )
    .all();
  assert.equal(trackerProjects.length, 2);
  assert.equal(new Set(trackerProjects.map((row) => row.entity_key)).size, 2);
  const persistedText = stringifySqliteRows([
    ...projectRows,
    ...trackerProjects,
  ]);
  assert.equal(persistedText.includes("/Users/alice"), false);

  const hydrated = await repository.load();
  assert.equal(hydrated.envelope.data?.details.length, 0);
  assert.equal(hydrated.envelope.data?.recent.length, 0);
  assert.equal(
    hydrated.envelope.data?.aggregateBuckets?.filter(
      (bucket) => bucket.projectLabel === "shared",
    ).length,
    2,
  );
});

test("fresh baseline includes empty aggregate and tracker projections", (t) => {
  const database = openDatabase(t);
  for (const table of [
    "usage_aggregate_snapshots",
    "usage_aggregate_sources",
    "usage_aggregate_source_diagnostics",
    "usage_aggregate_buckets",
    "usage_aggregate_bucket_tools",
    "usage_tracker_buckets",
  ]) {
    assert.ok(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table),
      `missing ${table}`,
    );
    assert.equal(
      Number(
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count,
      ),
      0,
    );
  }
  const projectKind = database
    .prepare(
      "SELECT name, dflt_value FROM pragma_table_info('usage_aggregate_buckets') WHERE name = 'project_kind'",
    )
    .get();
  assert.equal(projectKind?.name, "project_kind");
  assert.equal(projectKind?.dflt_value, "'unknown'");
});

test("session, skill and installation DTOs survive restart-safe normalized reads", async (t) => {
  const database = openDatabase(t);
  const common = { database, hmacKey: "test-installation-key" };
  const sessions = createSqliteSessionSnapshotRepository(common);
  await sessions.save(
    envelope("sessions-1", {
      generatedAt: "2026-08-19T01:02:03.000Z",
      sessions: [
        {
          sessionId: "session-a",
          source: "codex",
          title: "Safe title",
          projectKey: "project-a",
          projectRef: "C:\\private\\project-a",
          model: "gpt-test",
          startedAt: "2026-08-19T01:00:00.000Z",
          endedAt: "2026-08-19T01:01:00.000Z",
          durationMs: 60_000,
          turns: 2,
          editTurns: 1,
          retryTurns: 0,
          totals: {
            inputTokens: 5,
            outputTokens: 2,
            cachedInputTokens: 1,
            cacheCreationInputTokens: 0,
            reasoningOutputTokens: 0,
            totalTokens: 8,
          },
          cost: {
            knownUsd: 0.125,
            estimatedUsd: 0,
            cacheSavingsUsd: 0.01,
            pricedEvents: 1,
            estimatedEvents: 0,
            unknownEvents: 0,
            unknownModels: [],
            complete: true,
          },
          subagentCalls: 0,
          status: "available" as const,
          statusReason: null,
          resumeAvailable: true,
        },
      ],
      density: [
        {
          source: "codex",
          date: "2026-08-19",
          count: 1,
          turns: 2,
          editTurns: 1,
          subagentCalls: 0,
          totalTokens: 8,
          knownUsd: 0.125,
        },
      ],
    }),
  );
  const sessionLoaded =
    await createSqliteSessionSnapshotRepository(common).load();
  assert.equal(sessionLoaded.envelope.data?.sessions[0]?.cost.knownUsd, 0.125);
  assert.equal(
    sessionLoaded.envelope.data?.sessions[0]?.sessionId,
    "session-a",
  );
  assert.equal(
    database.prepare("SELECT project_ref_hash FROM sessions").get()!
      .project_ref_hash === "C:\\private\\project-a",
    false,
  );

  const skills = createSqliteSkillSnapshotRepository(common);
  await skills.save(
    envelope("skills-1", {
      generatedAt: "2026-08-19T01:02:03.000Z",
      fingerprint: "skills-fp",
      roots: { codex: { count: 1 } },
      agents: { codex: { installed: true } },
      blacklist: ["blocked-skill"],
      skills: [
        {
          id: "skill-a",
          name: "Skill A",
          description: null,
          lastUsedAt: null,
          sizeBytes: 10,
          tokenEstimate: 3,
          installations: [
            {
              agent: "codex",
              installedAt: "2026-08-18T00:00:00.000Z",
              modifiedAt: "2026-08-19T00:00:00.000Z",
              version: null,
              source: null,
              updateStatus: "unknown" as const,
              updateReason: "not-checked",
            },
          ],
        },
      ],
    }),
  );
  assert.equal(
    (await createSqliteSkillSnapshotRepository(common).load()).envelope.data
      ?.skills[0]?.name,
    "Skill A",
  );

  const installations = createSqliteInstallationSnapshotRepository({
    database,
  });
  await installations.save(
    envelope("install-1", {
      generatedAt: "2026-08-19T01:02:03.000Z",
      facts: [
        {
          id: "codex",
          installed: true,
          executableFound: true,
          paths: ["~/.codex", "C:\\must-not-persist"],
        },
      ],
    }),
  );
  assert.deepEqual(
    (await createSqliteInstallationSnapshotRepository({ database }).load())
      .envelope.data?.facts[0]?.paths,
    ["~/.codex"],
  );
});

test("classification index stores only HMAC refs and preserves lookup contract", async (t) => {
  const database = openDatabase(t);
  const repository = createSqliteClassificationIndexRepository({
    database,
    hmacKey: "test-installation-key",
  });
  const raw = "C:\\Users\\alice\\workspace";
  await repository.commit([
    {
      ref: raw,
      kind: "workspace",
      label: "workspace",
      classifiedAt: "2026-08-19T01:02:03.000Z",
      fingerprint: "mtime-1",
    },
  ]);
  assert.equal((await repository.get(raw))?.kind, "workspace");
  const stored = String(
    database.prepare("SELECT ref_hash FROM project_classifications").get()!
      .ref_hash,
  );
  assert.notEqual(stored, raw);
  assert.ok(
    !stringifySqliteRows(
      database.prepare("SELECT * FROM project_classifications").all(),
    ).includes("C:\\Users"),
  );
});
