import assert from "node:assert/strict";
import test from "node:test";

import { resolveNpmSpawn } from "./npm-spawn.mjs";

test("Windows npm commands run through cmd.exe", () => {
  assert.deepEqual(
    resolveNpmSpawn(["run", "dev:desktop"], {
      platform: "win32",
      environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    }),
    {
      executable: "C:\\Windows\\System32\\cmd.exe",
      argumentsList: ["/d", "/s", "/c", "npm.cmd", "run", "dev:desktop"],
    },
  );
});

test("Windows npm commands have a safe command-processor fallback", () => {
  assert.equal(
    resolveNpmSpawn([], { platform: "win32", environment: {} }).executable,
    "cmd.exe",
  );
});

test("POSIX npm commands execute directly", () => {
  assert.deepEqual(
    resolveNpmSpawn(["run", "build"], {
      platform: "darwin",
      environment: {},
    }),
    { executable: "npm", argumentsList: ["run", "build"] },
  );
});
