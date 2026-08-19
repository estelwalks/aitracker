import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import { createSqliteAIExecutionRepository } from "./sqlite-ai-execution-repository.server.ts";

function fixture(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-ai-audit-repo-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

function execution(requestId: string) {
  return {
    capability: "page-insight" as const,
    summary: {
      requestId,
      modelId: "model",
      providerId: "provider",
      promptVersionId: "insight.summary",
      promptVersion: 1,
      status: "completed" as const,
      cost: {
        confidence: "exact" as const,
        amountUsd: 0.001,
        currency: "USD" as const,
        reason: "priced" as const,
      },
      usedFallback: false,
    },
    inputFingerprint: "a".repeat(64),
    usage: { inputTokens: 10, outputTokens: 5 },
    costMicrousd: 1_000n,
    startedAtMs: 100,
    finishedAtMs: 120,
    durationMs: 20,
  };
}

test("rules mode never writes AI audit or usage rows", (t) => {
  const host = fixture(t);
  const repository = createSqliteAIExecutionRepository(host);
  const result = repository.recordWithBudget({
    mode: "rules",
    key: {
      dateKey: "2026-08-19",
      capability: "page-insight",
      profileKey: "offline",
    },
    dailyCallLimit: 1,
    execution: execution("rules-request"),
    nowMs: 200,
  });
  assert.deepEqual(result, { outcome: "rules", recorded: false });
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM ai_executions").get()?.n,
    0n,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM ai_daily_usage").get()?.n,
    0n,
  );
});

test("enhanced budget and audit update atomically and are request-id idempotent", (t) => {
  const repository = createSqliteAIExecutionRepository(fixture(t));
  const key = {
    dateKey: "2026-08-19",
    capability: "page-insight" as const,
    profileKey: "offline",
  };
  const first = repository.recordWithBudget({
    mode: "enhanced-manual",
    key,
    dailyCallLimit: 1,
    execution: execution("request-1"),
    nowMs: 200,
  });
  assert.equal(first.outcome, "recorded");
  if (first.outcome !== "recorded") throw new Error("expected recorded");
  assert.equal(first.usage.calls, 1n);
  const duplicate = repository.recordWithBudget({
    mode: "enhanced-manual",
    key,
    dailyCallLimit: 2,
    execution: execution("request-1"),
    nowMs: 201,
  });
  if (duplicate.outcome === "rules")
    throw new Error("expected enhanced result");
  assert.equal(duplicate.usage.calls, 1n);
  const blocked = repository.recordWithBudget({
    mode: "enhanced-auto",
    key,
    dailyCallLimit: 1,
    execution: execution("request-2"),
    nowMs: 202,
  });
  assert.equal(blocked.outcome, "budget-exceeded");
  if (blocked.outcome !== "budget-exceeded") {
    throw new Error("expected budget-exceeded");
  }
  assert.equal(blocked.usage.calls, 1n);
  assert.deepEqual(
    repository
      .listRecent()
      .map((row) => row.status)
      .sort(),
    ["budget", "completed"],
  );
});

test("transaction rollback prevents usage increments when audit insert fails", (t) => {
  const repository = createSqliteAIExecutionRepository(fixture(t));
  const key = {
    dateKey: "2026-08-19",
    capability: "page-insight" as const,
    profileKey: "missing-profile",
  };
  assert.throws(
    () =>
      repository.recordWithBudget({
        mode: "enhanced-manual",
        key,
        dailyCallLimit: null,
        execution: { ...execution("bad-fk"), profileId: "missing-profile" },
        nowMs: 200,
      }),
    (error: unknown) =>
      error instanceof DatabaseError && error.code === "constraint-violation",
  );
  assert.equal(repository.getUsage(key).calls, 0n);
});
