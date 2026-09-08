import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { getDefaultRegistry } from "../tool-registry/registry.ts";
import {
  firstPathSegment,
  isHomeFlattenedRoot,
  rebaseRoot,
  stripDataSegment,
  uniformDataSegment,
} from "./placement.server.ts";
import {
  TOOL_DATA_ROOTS_ENV,
  dataSegmentForTool,
  isToolDataRootConfigurable,
  loadEffectiveToolDataRoots,
  parseToolDataRootsEnv,
} from "./tool-data-root.server.ts";

const registry = getDefaultRegistry();
const defOf = (id: string) => {
  const def = registry.byId.get(id);
  assert.ok(def, `tool ${id}`);
  return def;
};

test("env seam parses toolId=path pairs and accepts drive-letter paths", () => {
  const map = parseToolDataRootsEnv(
    "hermes=/data/hermes,claude-code=C:/data/claude,broken,pi=",
  );
  assert.deepEqual(
    [...map.entries()],
    [
      ["hermes", "/data/hermes"],
      ["claude-code", "C:/data/claude"],
    ],
  );
  assert.equal(
    parseToolDataRootsEnv("hermes=/a,hermes=D:\\hermes").get("hermes"),
    "D:\\hermes",
  );
  assert.equal(parseToolDataRootsEnv(undefined).size, 0);
});

test("effective roots merge the repository with env (env wins)", async () => {
  const repository = {
    async list() {
      return [
        { toolId: "hermes", dataDir: "/repo/hermes" },
        { toolId: "dsh", dataDir: "/repo/dsh" },
      ];
    },
  };
  const env: Record<string, string> = {
    [TOOL_DATA_ROOTS_ENV]: "hermes=/env/hermes",
  };
  const map = await loadEffectiveToolDataRoots(repository as never, env);
  assert.equal(map.get("hermes"), "/env/hermes");
  assert.equal(map.get("dsh"), "/repo/dsh");
});

test("placement helpers rebase HOME-anchored roots under an override", () => {
  assert.equal(firstPathSegment(".hermes/state.db"), ".hermes");
  assert.equal(firstPathSegment("AppData/hermes"), "AppData");
  assert.equal(isHomeFlattenedRoot(".hermes"), true);
  assert.equal(isHomeFlattenedRoot("AppData/hermes"), false);
  assert.equal(uniformDataSegment([".hermes", ".hermes/state.db"]), ".hermes");
  assert.equal(
    uniformDataSegment([".hermes", ".claude"]),
    null,
    "conflicting segments are not rebasable",
  );
  assert.equal(stripDataSegment(".hermes/state.db", ".hermes"), "state.db");
  assert.equal(rebaseRoot(".hermes", ".hermes", "/data/h"), "/data/h");
  assert.equal(
    rebaseRoot(".hermes/state.db", ".hermes", "/data/h"),
    join("/data/h", "state.db"),
  );
  assert.equal(rebaseRoot(".claude/x", ".hermes", "/data/h"), null);
});

test("registry tools expose a uniform data segment", () => {
  assert.equal(dataSegmentForTool(defOf("hermes")), ".hermes");
  assert.equal(dataSegmentForTool(defOf("pi")), ".pi");
  assert.equal(dataSegmentForTool(defOf("claude-code")), ".claude");
  assert.equal(dataSegmentForTool(defOf("dsh")), ".dsh");
});

test("configurability follows usage or HOME detection roots", () => {
  assert.equal(isToolDataRootConfigurable(defOf("hermes"), "macos"), true);
  assert.equal(isToolDataRootConfigurable(defOf("hermes"), "windows"), true);
  assert.equal(isToolDataRootConfigurable(defOf("pi"), "macos"), true);
});
