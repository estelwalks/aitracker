import assert from "node:assert";
import { test } from "node:test";

import type { InstallationFactData } from "./installation-snapshot.contracts.ts";
import {
  SKILL_AGENT_TOOL_IDS,
  newlyInstalledToolIds,
  sessionEvidenceToolIds,
  shouldRequestInstallationProbe,
  toolsMissingInstallationFact,
  usageEvidenceToolIds,
  type UsageEvidenceSource,
} from "./discovery-sync.server.ts";

function fact(id: string, installed: boolean): InstallationFactData {
  return { id, installed, paths: [], executableFound: false };
}

function usageSummary(partial: UsageEvidenceSource): UsageEvidenceSource {
  return partial;
}

test("usageEvidenceToolIds: detected roots or parsed events prove an install", () => {
  const ids = usageEvidenceToolIds([
    // Detected root without events still proves the tool is installed.
    usageSummary({ source: "codex", detected: true, events: 0 }),
    // Parsed events with an available source also count (detected may be
    // unset on some scanner paths).
    usageSummary({ source: "pi", available: true, events: 21 }),
    // Nothing found: no evidence.
    usageSummary({ source: "cursor" }),
  ]);
  assert.deepEqual(ids, ["codex", "pi"]);
});

test("sessionEvidenceToolIds: distinct session sources", () => {
  const ids = sessionEvidenceToolIds([
    { source: "pi" },
    { source: "claude-code" },
    { source: "pi" },
  ]);
  assert.deepEqual(ids, ["pi", "claude-code"]);
});

test("toolsMissingInstallationFact: only evidence without an installed fact", () => {
  const facts = [fact("claude-code", true), fact("codex", false)];
  assert.deepEqual(
    toolsMissingInstallationFact(["claude-code", "codex", "pi"], facts),
    ["codex", "pi"],
  );
  assert.deepEqual(toolsMissingInstallationFact([], facts), []);
});

test("shouldRequestInstallationProbe: throttled after a recent probe", () => {
  const nowMs = 1_000_000;
  assert.equal(
    shouldRequestInstallationProbe({
      missingToolIds: [],
      lastProbeSuccessAtMs: null,
      nowMs,
    }),
    false,
  );
  // First evidence with no probe history probes immediately.
  assert.equal(
    shouldRequestInstallationProbe({
      missingToolIds: ["pi"],
      lastProbeSuccessAtMs: null,
      nowMs,
    }),
    true,
  );
  // A persistent mismatch must not re-probe on every usage/session tick.
  assert.equal(
    shouldRequestInstallationProbe({
      missingToolIds: ["pi"],
      lastProbeSuccessAtMs: nowMs - 60_000,
      nowMs,
    }),
    false,
  );
  assert.equal(
    shouldRequestInstallationProbe({
      missingToolIds: ["pi"],
      lastProbeSuccessAtMs: nowMs - 16 * 60_000,
      nowMs,
    }),
    true,
  );
});

test("newlyInstalledToolIds: only false->true flips with known history", () => {
  const previous = [
    fact("claude-code", true),
    fact("codex", false),
    fact("pi", false),
  ];
  const next = [
    fact("claude-code", true),
    fact("codex", true),
    fact("pi", false),
  ];
  assert.deepEqual(newlyInstalledToolIds(previous, next), ["codex"]);
  // Unknown history (first probe after a reset) reports nothing new.
  assert.deepEqual(newlyInstalledToolIds(null, next), []);
});

test("SKILL_AGENT_TOOL_IDS: skill-capable agents only", () => {
  // Claude Code carries discoverable skill roots...
  assert.equal(SKILL_AGENT_TOOL_IDS.has("claude-code"), true);
  // ...while pi declares skills unsupported and must never trigger a skills
  // rescan on install.
  assert.equal(SKILL_AGENT_TOOL_IDS.has("pi"), false);
});
