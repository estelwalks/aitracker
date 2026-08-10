import assert from "node:assert/strict";
import test from "node:test";

import {
  availableAssetSorts,
  buildSkillAssetSummary,
  buildSkillWorkspace,
  querySkillAssets,
} from "./asset-view.ts";
import type { SkillSnapshot } from "../query.ts";

const snapshot = {
  generatedAt: "2026-08-10T08:00:00.000Z",
  fingerprint: "test",
  roots: { Codex: { count: 1 }, Claude: { count: 0 } },
  agents: { Codex: { installed: true }, Claude: { installed: false } },
  blacklist: [],
  skills: [
    {
      id: "alpha",
      name: "Alpha",
      description: "Market helper",
      lastUsedAt: "2026-08-09T08:00:00.000Z",
      installations: [
        {
          installationRef: "installation:alpha:Codex:0",
          agent: "Codex",
          installedAt: "2026-08-01T08:00:00.000Z",
          modifiedAt: "2026-08-08T08:00:00.000Z",
          version: "2.0.0",
          source: { kind: "market" },
          updateStatus: "available",
          updateReason: "evidence",
        },
      ],
    },
    {
      id: "beta",
      name: "Beta",
      description: null,
      lastUsedAt: null,
      installations: [
        {
          installationRef: "installation:beta:Claude:0",
          agent: "Claude",
          installedAt: "2026-08-02T08:00:00.000Z",
          modifiedAt: "2026-08-07T08:00:00.000Z",
          version: null,
          source: { kind: "frontmatter" },
          updateStatus: "current",
          updateReason: "evidence",
        },
      ],
    },
  ],
} as unknown as SkillSnapshot;

test("asset view combines browser-safe filters and scanner-backed sort fields", () => {
  const result = querySkillAssets(snapshot, {
    text: "helper",
    agent: "Codex" as never,
    source: "market",
    updateStatus: "available",
    sort: "modifiedAt",
    direction: "desc",
  });
  assert.deepEqual(
    result.map((skill) => skill.id),
    ["alpha"],
  );
  assert.deepEqual(result[0]?.sourceKinds, ["market"]);
  assert.deepEqual(result[0]?.versions, ["2.0.0"]);
  assert.equal(result[0]?.latestModifiedAt, "2026-08-08T08:00:00.000Z");
  assert.deepEqual(availableAssetSorts(snapshot), [
    "name",
    "lastUsedAt",
    "modifiedAt",
  ]);
});

test("asset summary is derived from the scan snapshot without invented metrics", () => {
  assert.deepEqual(buildSkillAssetSummary(snapshot), {
    skillCount: 2,
    installationCount: 2,
    availableAgentCount: 1,
    detectedAgentCount: 1,
    lastScannedAt: "2026-08-10T08:00:00.000Z",
  });
});

test("workspace exposes only aggregate coverage, facets, and safe asset views", () => {
  const workspace = buildSkillWorkspace(snapshot);

  assert.deepEqual(workspace.summary, {
    skillCount: 2,
    installationCount: 2,
    availableAgentCount: 1,
    detectedAgentCount: 1,
    lastScannedAt: "2026-08-10T08:00:00.000Z",
    activeAgentCount: 1,
    coveragePercent: 100,
    updateAvailableCount: 1,
    unassignedSkillCount: 0,
  });
  assert.deepEqual(workspace.coverage, [
    { agent: "Codex", installed: true, skillCount: 1, state: "covered" },
    { agent: "Claude", installed: false, skillCount: 1, state: "unavailable" },
  ]);
  assert.deepEqual(workspace.facets.sources, [
    { value: "market", count: 1 },
    { value: "frontmatter", count: 1 },
  ]);
  assert.equal("path" in workspace.items[0]!, false);
  assert.equal("roots" in workspace, false);
});
