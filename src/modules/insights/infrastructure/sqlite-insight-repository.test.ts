import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import {
  createSqliteInsightRepository,
  type InsightEnhancementCache,
} from "./sqlite-insight-repository.server.ts";

function fixture(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-insight-repo-"));
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

function cache(
  cacheKey = "cache-a",
  analysis = "Review workload pressure",
): InsightEnhancementCache {
  return {
    cacheKey,
    surfaceId: "dashboard",
    scopeHash: "scope-hash",
    evidenceHash: "evidence-hash",
    locale: "en-US",
    profileId: null,
    promptVersionId: "page-insight",
    promptVersion: 1,
    modelLabel: "model",
    aiRequestId: null,
    generatedAtMs: 100,
    expiresAtMs: 200,
    status: "ready",
    lines: [
      {
        sequence: 0,
        candidateId: "candidate",
        analysis,
        actionId: "open-details",
      },
    ],
  };
}

test("surface preference overrides global", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const global = {
    scopeKey: "global",
    mode: "rules" as const,
    profileId: null,
    consentVersion: null,
    consentedAtMs: null,
    dailyCallLimit: null,
    updatedAtMs: 10,
  };
  repository.setPreference(global);
  repository.setPreference({
    ...global,
    scopeKey: "surface:dashboard",
    mode: "enhanced-manual",
    dailyCallLimit: 3,
    updatedAtMs: 11,
  });
  assert.equal(
    repository.getEffectivePreference("dashboard").mode,
    "enhanced-manual",
  );
  assert.equal(repository.getEffectivePreference("tracker").mode, "rules");
});

test("fresh databases default insight enhancement to enabled", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  assert.deepEqual(repository.getEffectivePreference("dashboard"), {
    scopeKey: "global",
    mode: "enhanced-auto",
    profileId: null,
    consentVersion: "1",
    consentedAtMs: 0,
    dailyCallLimit: null,
    updatedAtMs: 0,
  });
});

test("refresh interval persists independently from insight mode", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  assert.equal(repository.getRefreshIntervalMs(), 5 * 60 * 60 * 1000);
  repository.setRefreshIntervalMs(6 * 60 * 60 * 1000, 20);
  assert.equal(repository.getRefreshIntervalMs(), 6 * 60 * 60 * 1000);
  repository.setRefreshIntervalMs(5 * 60 * 60 * 1000, 19);
  assert.equal(
    repository.getRefreshIntervalMs(),
    6 * 60 * 60 * 1000,
    "older writes must not overwrite a newer interval",
  );
});

test("insight toggle preference persists local-rules and enhanced-auto modes", (t) => {
  const repository = createSqliteInsightRepository(fixture(t));
  const base = {
    scopeKey: "global",
    profileId: null,
    consentVersion: null,
    consentedAtMs: null,
    dailyCallLimit: null,
    updatedAtMs: 20,
  };

  repository.setPreference({ ...base, mode: "enhanced-auto", updatedAtMs: 21 });
  assert.equal(
    repository.getEffectivePreference("dashboard").mode,
    "enhanced-auto",
  );

  repository.setPreference({ ...base, mode: "rules", updatedAtMs: 22 });
  assert.equal(repository.getEffectivePreference("dashboard").mode, "rules");
});

test("rules mode writes no enhancement cache", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  assert.equal(
    repository.saveEnhancement({ mode: "rules", value: cache() }),
    false,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    0n,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_lines").get()
      ?.n,
    0n,
  );
});

test("enhancement cache enforces identity replacement, line ordering and TTL", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-manual", value: cache() }),
    true,
  );
  const identity = cache();
  assert.equal(repository.findValid(identity, 199)?.cacheKey, "cache-a");
  assert.equal(repository.findValid(identity, 200), undefined);
  assert.equal(
    repository.saveEnhancement({
      mode: "enhanced-auto",
      value: { ...cache("cache-b"), expiresAtMs: 300 },
    }),
    true,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    1n,
  );
  assert.equal(repository.findValid(identity, 250)?.cacheKey, "cache-b");
  assert.equal(repository.pruneExpired(300), 1);
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_lines").get()
      ?.n,
    0n,
  );
});

test("model changes invalidate every ready enhancement cache", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  const first = cache("cache-first");
  const second = {
    ...cache("cache-second"),
    surfaceId: "tracker" as const,
    scopeHash: "tracker-scope",
    evidenceHash: "tracker-evidence",
  };
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: first }),
    true,
  );
  assert.equal(
    repository.saveEnhancement({ mode: "enhanced-auto", value: second }),
    true,
  );
  assert.equal(repository.invalidateAll?.(), 2);
  assert.equal(repository.findValid(first, 150), undefined);
  assert.equal(repository.findValid(second, 150), undefined);
});

test("privacy guard rejects facts, URLs, commands and current entity names atomically", (t) => {
  const host = fixture(t);
  const repository = createSqliteInsightRepository(host);
  for (const analysis of [
    "Used 42 calls",
    "Visit https://example.com",
    "Run npm install",
    "Focus on ProjectAlpha",
  ]) {
    assert.throws(
      () =>
        repository.saveEnhancement({
          mode: "enhanced-manual",
          value: cache(`cache-${analysis.length}`, analysis),
          forbiddenEntities: ["ProjectAlpha"],
        }),
      (error: unknown) =>
        error instanceof DatabaseError && error.code === "invalid-argument",
    );
  }
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM insight_enhancement_cache").get()
      ?.n,
    0n,
  );
});
