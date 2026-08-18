import assert from "node:assert";
import { test } from "node:test";

import { AI_TOOLS } from "../tools/catalog.ts";
import { deriveToolInstallationFacts } from "../tools/detection.server.ts";
import type { LocalUsageSourceSummary } from "./types.ts";
import { deriveUsageSources } from "./get-usage-sources.ts";

const HOME = "/Users/x";

function installations(...roots: string[]) {
  return deriveToolInstallationFacts(
    AI_TOOLS,
    new Set(roots.map((root) => `${HOME}/${root}`)),
    HOME,
  );
}

function summary(
  partial: Partial<LocalUsageSourceSummary>,
): LocalUsageSourceSummary {
  return {
    source: "claude-code",
    available: false,
    detected: false,
    filesConsidered: 0,
    filesRead: 0,
    filesReused: 0,
    filesParsed: 0,
    malformedLines: 0,
    events: 0,
    ...partial,
  } as LocalUsageSourceSummary;
}

test("has-data: a tool with available=true and events>0", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [summary({ source: "claude-code", available: true, events: 5 })],
    installations(".claude"),
    "2026-08-03T00:00:00.000Z",
    HOME,
  );
  const claude = out.entries.find((e) => e.id === "claude-code")!;
  assert.equal(claude.status, "has-data");
  assert.equal(claude.events, 5);
  assert.equal(claude.lastScannedAt, "2026-08-03T00:00:00.000Z");
  assert.equal(out.totals.connectedCount, 1);
  // 30 catalog tools, 1 connected -> 29 not installed (dsh + aipy/cline visible).
  assert.equal(out.totals.notInstalledCount, 29);
  assert.equal(out.totals.eventCount, 5);
});

test("no-logs: detected but events=0", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [
      summary({
        source: "codex",
        detected: true,
        available: false,
        events: 0,
        paths: [`${HOME}/.codex`],
      }),
    ],
    installations(".codex"),
    "t",
    HOME,
  );
  const codex = out.entries.find((e) => e.id === "codex")!;
  assert.equal(codex.status, "no-logs");
  assert.equal(out.totals.noLogsCount, 1);
  assert.equal(out.totals.connectedCount, 0);
});

test("not-installed: tool absent from summaries", () => {
  const out = deriveUsageSources(AI_TOOLS, [], installations(), "t", HOME);
  const cursor = out.entries.find((e) => e.id === "cursor")!;
  assert.equal(cursor.status, "not-installed");
  assert.equal(cursor.events, 0);
  assert.equal(cursor.lastScannedAt, "t");
  assert.equal(out.totals.toolCount, 30);
  assert.equal(out.totals.notInstalledCount, 30);
});

test("HOME-normalization: catalog relative path gets ~/, absolute scanner path rewritten", () => {
  const out = deriveUsageSources(AI_TOOLS, [], installations(), "t", HOME);
  const claude = out.entries.find((e) => e.id === "claude-code")!;
  // catalog detectRoots are HOME-relative -> "~/.claude" and the macOS path.
  assert.ok(claude.paths.includes("~/.claude"));

  // Scanner absolute path under HOME is rewritten to ~/.
  const outAbs = deriveUsageSources(
    AI_TOOLS,
    [summary({ source: "grok", detected: true, paths: [`${HOME}/.grok`] })],
    installations(".grok"),
    "t",
    HOME,
  );
  const grok = outAbs.entries.find((e) => e.id === "grok")!;
  assert.ok(grok.paths.includes("~/.grok"));

  const outExternal = deriveUsageSources(
    AI_TOOLS,
    [summary({ source: "grok", paths: ["/var/private/grok"] })],
    installations(".grok"),
    "t",
    HOME,
  );
  const externalGrok = outExternal.entries.find((e) => e.id === "grok")!;
  assert.equal(externalGrok.paths.includes("/var/private/grok"), false);
});

test("totals aggregate across multiple connected tools", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [
      summary({
        source: "claude-code",
        available: true,
        events: 5,
        malformedLines: 1,
      }),
      summary({
        source: "codex",
        available: true,
        events: 3,
        malformedLines: 2,
      }),
    ],
    installations(".claude", ".codex"),
    "t",
    HOME,
  );
  assert.equal(out.totals.connectedCount, 2);
  assert.equal(out.totals.eventCount, 8);
  assert.equal(out.totals.malformedCount, 3);
});
