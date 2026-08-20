import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
  const directory = mkdtempSync(join(tmpdir(), "tt-m3-"));
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

test("usage generation is atomic and never persists raw project/session/command refs", async (t) => {
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
      "SELECT project_ref_hash,project_label,session_ref FROM usage_events",
    )
    .get()!;
  assert.notEqual(persisted.project_ref_hash, event.project);
  assert.notEqual(persisted.session_ref, event.sessionId);
  assert.equal(persisted.project_label, "secret-repo");
  assert.equal(
    database
      .prepare("SELECT executable_label FROM usage_event_command_stats")
      .get()!.executable_label,
    "cmd.exe",
  );
  assert.ok(
    !stringifySqliteRows(
      database.prepare("SELECT * FROM usage_events").all(),
    ).includes("C:\\Users"),
  );

  const bad = structuredClone(data);
  bad.details[0].context.commands.push({
    ...bad.details[0].context.commands[0],
  });
  await assert.rejects(repository.save(envelope("r2", bad)));
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
  assert.notEqual(
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
