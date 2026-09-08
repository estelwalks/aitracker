import assert from "node:assert";
import { test } from "node:test";

import { AI_TOOLS } from "../tools/catalog.ts";
import { deriveToolInstallationFacts } from "../tools/detection.server.ts";
import type { LocalUsageSourceSummary } from "./types.ts";
import { deriveUsageSources } from "./get-usage-sources.ts";

const HOME = "/Users/x";

// These are pure projection tests over the macOS path plan (the fixture HOME
// and roots are POSIX/macOS-shaped). Pin the os explicitly: the registry marks
// most tools as linux "planned", so deriving facts from the runner's platform
// (e.g. ubuntu CI) would empty every probe root and flip these tools to
// "not-installed" no matter what the fixture contains.
function installations(...roots: string[]) {
  return deriveToolInstallationFacts(
    AI_TOOLS,
    new Set(roots.map((root) => `${HOME}/${root}`)),
    HOME,
    "macos",
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
  // 36 catalog tools, 1 connected -> 35 not installed.
  assert.equal(out.totals.notInstalledCount, 35);
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
  // Installation/detection is independent from log availability: the
  // dashboard and Agent overview count this tool as connected too.
  assert.equal(out.totals.connectedCount, 1);
});

test("has-data: persisted usage evidence survives an empty installation snapshot", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [
      summary({
        source: "codex",
        available: true,
        detected: undefined,
        events: 2,
      }),
    ],
    [],
    "2026-08-03T00:00:00.000Z",
    HOME,
  );
  const codex = out.entries.find((entry) => entry.id === "codex")!;
  assert.equal(codex.status, "has-data");
  assert.equal(out.totals.connectedCount, 1);
});

test("has-data: parsed usage evidence beats a stale not-installed fact", () => {
  // The installation probe can run before the tool is installed and its 6h
  // freshness window keeps the page from re-probing; the explicit
  // installed=false fact must never regress a source that already parsed
  // events or detected its log root.
  const staleFacts = deriveToolInstallationFacts(
    AI_TOOLS,
    new Set(), // no probe root existed at probe time
    HOME,
    "macos",
  );
  const stalePi = staleFacts.find((f) => f.id === "pi")!;
  assert.equal(stalePi.installed, false);

  const out = deriveUsageSources(
    AI_TOOLS,
    [
      summary({
        source: "pi",
        detected: true,
        available: true,
        events: 21,
      }),
    ],
    staleFacts,
    "2026-08-03T00:00:00.000Z",
    HOME,
  );
  const pi = out.entries.find((entry) => entry.id === "pi")!;
  assert.equal(pi.status, "has-data");
  assert.equal(pi.events, 21);
  assert.equal(out.totals.connectedCount, 1);
  assert.equal(out.totals.notInstalledCount, AI_TOOLS.length - 1);
});

test("not-installed: tool absent from summaries", () => {
  const out = deriveUsageSources(AI_TOOLS, [], installations(), "t", HOME);
  const cursor = out.entries.find((e) => e.id === "cursor")!;
  assert.equal(cursor.status, "not-installed");
  assert.equal(cursor.events, 0);
  assert.equal(cursor.lastScannedAt, "t");
  assert.equal(out.totals.toolCount, 36);
  assert.equal(out.totals.notInstalledCount, 36);
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

test("actual scanner paths take precedence over installation probe paths", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [
      summary({
        source: "workbuddy",
        detected: true,
        paths: [
          `${HOME}/.workbuddy/projects`,
          `${HOME}/.workbuddy/workbuddy.db`,
        ],
      }),
    ],
    installations(".workbuddy"),
    "t",
    HOME,
  );
  const workbuddy = out.entries.find((entry) => entry.id === "workbuddy")!;
  assert.deepEqual(workbuddy.paths, [
    "~/.workbuddy/projects",
    "~/.workbuddy/workbuddy.db",
  ]);
});

test("platform registry paths take precedence before the first usage snapshot", () => {
  const out = deriveUsageSources(
    AI_TOOLS,
    [],
    installations(".aipyapp"),
    "t",
    HOME,
    new Map([["aipy", ["~/Library/Application Support/aipy-pro"]]]),
  );
  const aipy = out.entries.find((entry) => entry.id === "aipy")!;
  assert.deepEqual(aipy.paths, ["~/Library/Application Support/aipy-pro"]);
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
