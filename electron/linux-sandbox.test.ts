import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canUseLinuxChromiumSandbox,
  executableDirectoryOf,
  sandboxDisabledByEnvironment,
} from "./linux-sandbox.js";

const HELPER = "/opt/AITracker/chrome-sandbox";

function probe(
  overrides: Partial<Parameters<typeof canUseLinuxChromiumSandbox>[0]> = {},
) {
  return {
    platform: "linux" as NodeJS.Platform,
    executableDirectory: "/opt/AITracker",
    isPackaged: true,
    // Present and readable by default; individual cases override the metadata.
    statHelper: () => ({ uid: 0, gid: 0, mode: 0o4755 }),
    readUsernsClone: () => "1",
    ...overrides,
  };
}

test("non-Linux platforms always keep the sandbox", () => {
  for (const platform of ["darwin", "win32"] as NodeJS.Platform[]) {
    assert.equal(
      canUseLinuxChromiumSandbox(
        probe({
          platform,
          // Even a definitively broken helper must not disable the sandbox off
          // Linux, where the whole question is irrelevant.
          statHelper: () => ({ uid: 1000, gid: 1000, mode: 0o755 }),
          readUsernsClone: () => "0",
        }),
      ),
      true,
    );
  }
});

test("a root-owned 4755 helper keeps the sandbox", () => {
  assert.equal(canUseLinuxChromiumSandbox(probe()), true);
});

test("a readable but non-SUID helper falls back to user namespaces", () => {
  // This is the exact state Chromium refuses with "The SUID sandbox helper
  // binary was found, but is not configured correctly".
  const notSuid = () => ({ uid: 0, gid: 0, mode: 0o755 });
  assert.equal(
    canUseLinuxChromiumSandbox(probe({ statHelper: notSuid })),
    true,
    "user namespaces available",
  );
  assert.equal(
    canUseLinuxChromiumSandbox(
      probe({ statHelper: notSuid, readUsernsClone: () => "0" }),
    ),
    false,
    "user namespaces disabled",
  );
});

test("a helper owned by a normal user falls back to user namespaces", () => {
  const userOwned = () => ({ uid: 1000, gid: 1000, mode: 0o4755 });
  assert.equal(
    canUseLinuxChromiumSandbox(probe({ statHelper: userOwned })),
    true,
  );
  assert.equal(
    canUseLinuxChromiumSandbox(
      probe({ statHelper: userOwned, readUsernsClone: () => "0" }),
    ),
    false,
  );
});

test("a missing helper is not itself fatal, but a missing knob is not evidence", () => {
  // No helper beside the executable: normal for an AppImage, where SUID bits
  // cannot survive the squashfs mount.
  const noHelper = probe({
    statHelper: () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    },
  });
  assert.equal(
    canUseLinuxChromiumSandbox({ ...noHelper, readUsernsClone: () => "1" }),
    true,
  );
  assert.equal(
    canUseLinuxChromiumSandbox({ ...noHelper, readUsernsClone: () => "0" }),
    false,
  );
  // An absent knob (non-Ubuntu kernels, unreadable /proc) must not be read as
  // "user namespaces are off" — guessing wrong here would strip the sandbox
  // from a host that works.
  assert.equal(
    canUseLinuxChromiumSandbox({ ...noHelper, readUsernsClone: () => null }),
    true,
  );
  assert.equal(
    canUseLinuxChromiumSandbox(
      probe({
        statHelper: () => {
          throw new Error("EACCES");
        },
        readUsernsClone: () => null,
      }),
    ),
    true,
  );
});

test("an unreadable helper entry does not fabricate a verdict", () => {
  assert.equal(
    canUseLinuxChromiumSandbox(
      probe({
        statHelper: () => {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        },
      }),
    ),
    true,
  );
});

test("ELECTRON_DISABLE_SANDBOX is recognised as an explicit user choice", () => {
  assert.equal(sandboxDisabledByEnvironment({}), false);
  assert.equal(
    sandboxDisabledByEnvironment({ ELECTRON_DISABLE_SANDBOX: "1" }),
    true,
  );
  assert.equal(
    sandboxDisabledByEnvironment({ ELECTRON_DISABLE_SANDBOX: "0" }),
    false,
  );
});

test("executableDirectoryOf returns the executable's directory", () => {
  assert.equal(
    executableDirectoryOf("/opt/AITracker/aitracker"),
    "/opt/AITracker",
  );
});
