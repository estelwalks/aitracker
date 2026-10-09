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
    [
      "~/AppData/Roaming/QoderCN/SharedClientCache/cache/db",
      "~/.qoder-cn/projects",
    ],
  );
  assert.deepEqual(
    sourcePathsForPlatform("qodercn", "macos", "/Users/tester"),
    [
      "~/Library/Application Support/QoderCN/SharedClientCache/cache/db",
      "~/.qoder-cn/projects",
    ],
  );
  assert.deepEqual(
    sourcePathsForPlatform("qoder", "macos", "/Users/tester"),
    [
      "~/Library/Application Support/Qoder/SharedClientCache/cache/db",
      "~/.qoder/projects",
    ],
  );
  assert.deepEqual(sourcePathsForPlatform("omo", "macos", "/Users/tester"), [
    "~/.omo/agent/sessions",
  ]);
  assert.deepEqual(
    sourcePathsForPlatform("prime-agent", "macos", "/Users/tester"),
    ["~/.prime/agent/sessions"],
  );
  assert.deepEqual(
    sourcePathsForPlatform("minimax-code", "macos", "/Users/tester"),
    ["~/.minimax/v2/sessions"],
  );
  assert.deepEqual(sourcePathsForPlatform("acode", "macos", "/Users/tester"), [
    "~/.acode/sessions",
    "~/.acode/archived_sessions",
  ]);
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
    "qodercn",
    "qoder",
    "omo",
    "prime-agent",
    "minimax-code",
    "acode",
    "reasonix",
    "dsh",
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
