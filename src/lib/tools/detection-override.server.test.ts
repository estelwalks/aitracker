import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { AI_TOOLS } from "./catalog.ts";
import {
  deriveToolInstallationFacts,
  detectionCandidatesForTool,
} from "./detection.server.ts";
import { getTool, getUsagePlan, osTargets } from "../tool-registry/registry.ts";

function tool(id: string) {
  const found = AI_TOOLS.find((candidate) => candidate.id === id);
  assert.ok(found, `catalog tool ${id} missing`);
  return found;
}

test("detection candidates rebase HOME roots under the override directory", () => {
  const home = "/home/alice";
  const override = "/data/hermes";
  const candidates = detectionCandidatesForTool(
    tool("hermes"),
    "macos",
    home,
    new Map([["hermes", override]]),
  );
  // The chosen directory itself plus the state.db file probe under it; the
  // stale ~/.hermes probes are gone.
  assert.deepEqual(candidates, [override, join(override, "state.db")]);
});

test("detection candidates stay default when no override is configured", () => {
  const home = "/home/alice";
  const candidates = detectionCandidatesForTool(tool("hermes"), "macos", home);
  assert.deepEqual(candidates, [
    join(home, ".hermes"),
    join(home, ".hermes/state.db"),
  ]);
});

test("derive facts honour overrides and ignore the stale default dir", () => {
  const home = "/home/alice";
  const override = "/data/hermes";
  const existing = new Set([
    join(home, ".hermes"), // stale leftover from a previous default install
    override,
    join(override, "state.db"),
  ]);
  const facts = deriveToolInstallationFacts(
    AI_TOOLS,
    existing,
    home,
    "macos",
    new Map(),
    new Map([["hermes", override]]),
  );
  const hermes = facts.find((fact) => fact.id === "hermes");
  assert.ok(hermes);
  assert.equal(hermes.installed, true);
  assert.deepEqual(hermes.detectedPaths, [
    override,
    join(override, "state.db"),
  ]);
});

test("platform gating still applies to overridden tools", () => {
  const hermes = tool("hermes");
  const targets = osTargets("windows");
  const def = getTool("hermes");
  assert.ok(def);
  const windowsArms = (def.detection.locations ?? []).filter((loc) =>
    loc.targets.some((target) => targets.includes(target)),
  );
  assert.ok(
    windowsArms.length >= 3,
    "windows detection should keep home + userProfile arms",
  );
  assert.ok(getUsagePlan("hermes"), "hermes usage plan is now declared");
});
