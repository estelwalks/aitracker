import assert from "node:assert/strict";
import test from "node:test";

import { AI_TOOL_IDS } from "../tools/catalog.ts";
import { sourcePathsForPlatform } from "./source-paths.ts";

test("macOS source paths use Application Support and XDG-compatible roots", () => {
  const paths = sourcePathsForPlatform(
    "cherrystudio",
    "macos",
    "/Users/tester",
  );
  assert.deepEqual(paths, [
    "~/Library/Application Support/CherryStudio/Data/Agents/.claude/projects",
    "~/Library/Application Support/CherryStudio/.claude/projects",
  ]);
});

test("Windows source paths use AppData/Roaming instead of macOS paths", () => {
  const paths = sourcePathsForPlatform(
    "cherrystudio",
    "windows",
    "C:\\Users\\tester",
  );
  assert.deepEqual(paths, [
    "~/AppData/Roaming/CherryStudio/Data/Agents/.claude/projects",
    "~/AppData/Roaming/CherryStudio/.claude/projects",
  ]);
});

test("AiPy usage paths follow the platform-specific registry definition", () => {
  assert.deepEqual(sourcePathsForPlatform("aipy", "macos", "/Users/tester"), [
    "~/Library/Application Support/aipy-pro",
  ]);
  assert.deepEqual(
    sourcePathsForPlatform("aipy", "windows", "C:\\Users\\tester"),
    ["~/AppData/Roaming/aipy-pro"],
  );
});

test("reference agents expose their actual platform-specific directories", () => {
  assert.deepEqual(
    sourcePathsForPlatform("qwen", "windows", "C:\\Users\\tester"),
    ["~/.qwen/projects"],
  );
  assert.deepEqual(
    sourcePathsForPlatform("qodercn", "windows", "C:\\Users\\tester"),
    ["~/AppData/Roaming/QoderCN/SharedClientCache/cache/db/local.db"],
  );
  assert.deepEqual(
    sourcePathsForPlatform("qodercn", "macos", "/Users/tester"),
    [
      "~/Library/Application Support/QoderCN/SharedClientCache/cache/db/local.db",
    ],
  );
});

test("the reference local-agent universe is present in the AITracker registry", () => {
  const referenceIds = [
    "claude-code",
    "codex",
    "opencode",
    "hermes",
    "openclaw",
    "cursor",
    "antigravity",
    "cline",
    "kimi-code",
    "qwen",
    "grok",
    "github-copilot",
    "pi",
    "zed",
    "kilocode",
    "commandcode",
    "mimo",
    "zcode",
    "kiro",
    "codebuddy",
    "workbuddy",
    "proma",
    "qodercn",
    "reasonix",
    "dsh",
    "cherrystudio",
  ];
  for (const id of referenceIds) {
    assert.ok(AI_TOOL_IDS.includes(id), `${id} must be registry-backed`);
  }
});

test("external environment overrides never cross the browser boundary", () => {
  assert.deepEqual(
    sourcePathsForPlatform("qodercn", "linux", "/home/tester", {
      XDG_CONFIG_HOME: "/srv/shared-config",
    }),
    [],
  );
});
