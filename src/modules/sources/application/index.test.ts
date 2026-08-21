import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourcesApplication, DEFAULT_MAX_AGE_MS } from "./index.ts";
import type { SourceHealthInputs } from "../contracts.ts";

const now = Date.parse("2026-08-07T00:00:00.000Z");
const base: SourceHealthInputs = {
  agentHealth: [
    {
      agentId: "codex",
      status: "healthy",
      observedAt: "2026-08-06T23:59:00.000Z",
    },
    {
      agentId: "linux-agent",
      status: "unavailable",
      observedAt: "2026-08-06T23:00:00.000Z",
      issueCode: "errors.platform-planned",
    },
  ],
  usageSnapshot: {
    generatedAt: "2026-08-06T23:59:00.000Z",
    mode: "real",
    sources: [
      {
        source: "codex",
        available: true,
        filesConsidered: 1,
        filesRead: 1,
        filesReused: 0,
        filesParsed: 1,
        malformedLines: 2,
        events: 1,
        diagnostics: [
          {
            code: "malformed-json",
            source: "codex",
            count: 1,
            message: "secret raw message",
          },
        ],
      },
      {
        source: "claude",
        available: false,
        filesConsidered: 1,
        filesRead: 0,
        filesReused: 0,
        filesParsed: 0,
        malformedLines: 0,
        events: 0,
      },
    ],
    events: 1,
    totals: {
      events: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
    bySource: [],
    byModel: [],
    byProject: [],
    daily: [],
    details: [],
    recent: [],
  },
};

test("projects health from injected snapshots without exposing diagnostics", async () => {
  let reads = 0;
  const probes = 0;
  const scans = 0;
  const result = await createSourcesApplication({
    repository: {
      async read() {
        reads++;
        return base;
      },
    },
    clock: () => now,
  }).getSourceHealth();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(reads, 1);
  assert.equal(probes, 0);
  assert.equal(scans, 0);
  const codex = result.value.sources.find((item) => item.sourceId === "codex");
  assert.deepEqual(codex, {
    sourceId: "codex",
    status: "degraded",
    freshness: "fresh",
    anomalyLines: 3,
    lastScannedAt: "2026-08-06T23:59:00.000Z",
    lastUpdatedAt: "2026-08-06T23:59:00.000Z",
    issueCodes: ["errors.source-malformed-json"],
  });
  assert.equal(JSON.stringify(result).includes("secret raw message"), false);
});

test("maps unavailable and planned sources, and stale snapshots", async () => {
  const result = await createSourcesApplication({
    repository: {
      async read() {
        return base;
      },
    },
    clock: () => now,
    defaultMaxAgeMs: 1,
  }).getSourceHealth();
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(
    result.value.sources.find((item) => item.sourceId === "claude")?.status,
    "unavailable",
  );
  const linux = result.value.sources.find(
    (item) => item.sourceId === "linux-agent",
  );
  assert.equal(linux?.status, "unavailable");
  assert.deepEqual(linux?.issueCodes, ["errors.platform-planned"]);
  assert.equal(linux?.freshness, "stale");
});

test("read failures return a stable error", async () => {
  const result = await createSourcesApplication({
    repository: {
      async read() {
        throw new Error("/private/path");
      },
    },
  }).getSourceHealth();
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error.code, "errors.sources.readFailed");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("default freshness follows the 1 minute Usage runtime policy", async () => {
  assert.equal(DEFAULT_MAX_AGE_MS, 60_000);
  const result = await createSourcesApplication({
    repository: {
      async read() {
        return {
          agentHealth: [
            {
              agentId: "codex",
              status: "healthy",
              observedAt: "2026-08-06T23:59:00.000Z",
            },
          ],
        };
      },
    },
    clock: () => now,
  }).getSourceHealth();
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.sources[0]?.freshness, "fresh");
});
