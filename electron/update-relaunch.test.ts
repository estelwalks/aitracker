import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWindowsHandoffCommand,
  handOffInstaller,
  WINDOWS_HANDOFF_COMMAND_NAME,
} from "./update-relaunch.ts";

function recordingSpawn() {
  const calls: Array<{
    command: string;
    args: readonly string[];
    options?: { windowsHide?: boolean; detached?: boolean };
  }> = [];
  const child = {
    unref() {
      return undefined;
    },
    on() {
      return child;
    },
  };
  const spawnFn = (
    command: string,
    args: readonly string[],
    options?: { windowsHide?: boolean; detached?: boolean },
  ): typeof child => {
    calls.push({ command, args, options });
    return child;
  };
  return { calls, spawnFn };
}

/** A spawn that starts but immediately reports an async failure. */
function failingSpawn(message: string) {
  const child = {
    unref() {
      return undefined;
    },
    on(event: string, listener: (error: Error) => void) {
      if (event === "error") {
        setTimeout(() => listener(new Error(message)), 0);
      }
      return child;
    },
  };
  return () => child;
}

const installerPath =
  "C:\\Users\\Me\\AppData\\Local\\Temp\\aitracker-setup.exe";
const appExecutablePath = "D:\\App\\Tools\\AITracker\\AITracker.exe";

test("the Windows hand-off script installs silently, then relaunches the app", () => {
  const script = buildWindowsHandoffCommand({
    installerPath,
    appExecutablePath,
    processId: 4321,
  });
  // ShellExecute through `start` (UAC) with a silent, update-aware install.
  assert.ok(
    script.includes(
      `start "" /wait "${installerPath}" /S --updated --force-run`,
    ),
  );
  // Diagnostics survive the closing console window.
  assert.ok(script.includes("aitracker-update-launch.log"));
  assert.ok(script.includes("pid=4321"));
  // Safety net uses hidden PowerShell: console programs (`ping`, `tasklist`,
  // `find`) would each pop a visible console window because this script runs
  // without one.
  assert.ok(script.includes("-WindowStyle Hidden"));
  assert.ok(
    script.includes(
      "Start-Process -FilePath 'D:\\App\\Tools\\AITracker\\AITracker.exe'",
    ),
  );
  assert.ok(!script.includes("ping -n"), "no ping: it pops a console window");
  assert.ok(
    !script.includes("tasklist") && !script.includes("find /I"),
    "no tasklist/find: they pop console windows",
  );
});

test("Windows hand-off runs the script with a hidden console window", async () => {
  const written: Array<{ path: string; data: string }> = [];
  const { calls, spawnFn } = recordingSpawn();
  const result = await handOffInstaller({
    platform: "win32",
    installerPath,
    appExecutablePath,
    processId: 77,
    tempDirectory: "C:\\Temp",
    writeFileFn: async (path, data) => {
      written.push({ path, data });
    },
    openPathFn: async () => {
      throw new Error("must not fall back when spawning works");
    },
    spawnFn,
    spawnProbeTimeoutMs: 10,
  });
  assert.deepEqual(result, { launched: true, method: "windows-hidden" });
  assert.equal(written.length, 1);
  assert.equal(written[0]!.path, `C:\\Temp\\${WINDOWS_HANDOFF_COMMAND_NAME}`);
  assert.ok(written[0]!.data.includes("--updated"));
  // Absolute cmd.exe, no manual quoting, and no visible console window.
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.command.toLowerCase().endsWith("cmd.exe"));
  assert.deepEqual(
    [...calls[0]!.args],
    ["/d", "/s", "/c", `C:\\Temp\\${WINDOWS_HANDOFF_COMMAND_NAME}`],
  );
  assert.equal(calls[0]!.options?.windowsHide, true);
  assert.equal(calls[0]!.options?.detached, true);
});

test("Windows hand-off falls back to ShellExecute when spawning fails", async () => {
  const opened: string[] = [];
  const asyncFailure = await handOffInstaller({
    platform: "win32",
    installerPath,
    tempDirectory: "C:\\Temp",
    writeFileFn: async () => undefined,
    openPathFn: async (path) => {
      opened.push(path);
      return "";
    },
    spawnFn: failingSpawn("ENOENT"),
    spawnProbeTimeoutMs: 10,
  });
  assert.deepEqual(asyncFailure, {
    launched: true,
    method: "windows-command",
  });
  assert.deepEqual(opened, [`C:\\Temp\\${WINDOWS_HANDOFF_COMMAND_NAME}`]);

  const syncFailure = await handOffInstaller({
    platform: "win32",
    installerPath,
    tempDirectory: "C:\\Temp",
    writeFileFn: async () => undefined,
    openPathFn: async () => "",
    spawnFn: () => {
      throw new Error("EPERM");
    },
    spawnProbeTimeoutMs: 10,
  });
  assert.equal(syncFailure.method, "windows-command");
});

test("Windows hand-off reports failures instead of throwing", async () => {
  const openFailure = await handOffInstaller({
    platform: "win32",
    installerPath,
    tempDirectory: "C:\\Temp",
    writeFileFn: async () => undefined,
    openPathFn: async () => "Access is denied.",
    spawnFn: () => {
      throw new Error("EPERM");
    },
    spawnProbeTimeoutMs: 10,
  });
  assert.equal(openFailure.launched, false);
  assert.equal(openFailure.reason, "Access is denied.");

  const writeFailure = await handOffInstaller({
    platform: "win32",
    installerPath,
    tempDirectory: "C:\\Temp",
    writeFileFn: async () => {
      throw new Error("disk full");
    },
    openPathFn: async () => "",
  });
  assert.equal(writeFailure.launched, false);
  assert.match(writeFailure.reason ?? "", /disk full/u);
});

test("macOS hand-off hands the downloaded image to open", async () => {
  const { calls, spawnFn } = recordingSpawn();
  const result = await handOffInstaller({
    platform: "darwin",
    installerPath: "/tmp/aitracker-2.0.0.dmg",
    spawnFn,
  });
  assert.deepEqual(result, { launched: true, method: "spawn" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "/usr/bin/open");
  assert.deepEqual([...calls[0]!.args], ["/tmp/aitracker-2.0.0.dmg"]);
});

test("a spawning failure reports the reason without throwing", async () => {
  const result = await handOffInstaller({
    platform: "darwin",
    installerPath: "/tmp/aitracker.dmg",
    spawnFn: () => {
      throw new Error("ENOENT");
    },
  });
  assert.deepEqual(result, { launched: false, reason: "ENOENT" });
});
