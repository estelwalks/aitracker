import assert from "node:assert/strict";
import test from "node:test";

import {
  appBundleFromExecutable,
  buildMacHandoffCommand,
  buildWindowsHandoffCommand,
  handOffInstaller,
  MACOS_HANDOFF_COMMAND_NAME,
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

const macInstallerPath = "/var/folders/xy/T/aitracker-AITracker-x64.dmg";
const macAppExecutable = "/Applications/AITracker.app/Contents/MacOS/AITracker";

test("appBundleFromExecutable finds the bundle and rejects foreign paths", () => {
  assert.equal(
    appBundleFromExecutable(macAppExecutable),
    "/Applications/AITracker.app",
  );
  assert.equal(
    appBundleFromExecutable(
      "/Users/me/Apps/AITracker 2.app/Contents/MacOS/AITracker",
    ),
    "/Users/me/Apps/AITracker 2.app",
  );
  assert.equal(appBundleFromExecutable("/usr/local/bin/aitracker"), null);
  assert.equal(appBundleFromExecutable("/Applications/AITracker.app"), null);
});

test("the macOS script installs in place and only falls back on failure", () => {
  const script = buildMacHandoffCommand({
    installerPath: macInstallerPath,
    appBundlePath: "/Applications/AITracker.app",
    processId: 4321,
    currentVersion: "1.0.0",
  });
  // Mounts without browsing at a mount point the script chooses. The volume
  // name must never be guessed: electron-builder names the image after its
  // release, so v1.0.1 mounts as "AITracker 1.0.1".
  assert.ok(script.includes("hdiutil attach -nobrowse"));
  assert.ok(script.includes('-mountpoint "$MOUNT_POINT"'));
  assert.ok(
    script.includes(
      'MOUNT_POINT="/var/folders/xy/T/aitracker-AITracker-x64.dmg.mnt"',
    ),
  );
  assert.ok(!script.includes("/Volumes/AITracker"));
  // Waits for this app to exit before touching the bundle: macOS refuses to
  // replace a running app.
  assert.ok(script.includes('kill -0 "$PID"'));
  // Refuses a downgrade and validates the incoming bundle first.
  assert.ok(script.includes("CFBundleShortVersionString"));
  assert.ok(script.includes('TARGET_NUMERIC="1.0.0"'));
  // Stages beside the target and keeps a backup, so a half-copied bundle can
  // never replace a working install.
  assert.ok(script.includes('STAGED="/Applications/.$APP_NAME.update"'));
  assert.ok(script.includes('BACKUP="/Applications/.$APP_NAME.backup"'));
  assert.ok(
    script.indexOf("ditto") < script.indexOf('mv "$APP" "$BACKUP"'),
    "the new bundle must be staged before the old one is moved aside",
  );
  assert.ok(
    script.indexOf('mv "$APP" "$BACKUP"') <
      script.indexOf('mv "$STAGED" "$APP"'),
    "the old bundle must be moved aside before the new one takes its place",
  );
  assert.ok(
    script.includes('mv "$BACKUP" "$APP"'),
    "a failed install must restore the backup",
  );
  // Every failure path hands the image to the manual flow instead.
  assert.ok(script.includes('/usr/bin/open "$DMG"'));
  assert.ok(script.includes("aitracker-update-launch.log"));
});

test("the macOS script never disables Gatekeeper protections", () => {
  const script = buildMacHandoffCommand({
    installerPath: macInstallerPath,
    appBundlePath: "/Applications/AITracker.app",
    processId: 1,
  });
  assert.ok(!script.includes("com.apple.quarantine"));
  assert.ok(!script.includes("spctl"));
  assert.ok(!script.includes("xattr -d"));
  assert.ok(!script.includes("sudo"));
});

test("a path that cannot be quoted safely is rejected instead of mangled", () => {
  assert.throws(
    () =>
      buildMacHandoffCommand({
        installerPath: "/tmp/it's here.dmg",
        appBundlePath: "/Applications/AITracker.app",
        processId: 1,
      }),
    /cannot quote for the shell/u,
  );
});

test("macOS hand-off arms the auto-install script and reports how", async () => {
  const written: Array<{ path: string; data: string; mode?: number }> = [];
  const { calls, spawnFn } = recordingSpawn();
  const result = await handOffInstaller({
    platform: "darwin",
    installerPath: macInstallerPath,
    appExecutablePath: macAppExecutable,
    processId: 99,
    currentVersion: "1.0.0",
    tempDirectory: "/tmp/handoff",
    writeFileFn: async (path, data, options) => {
      written.push({
        path,
        data,
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      });
    },
    spawnFn,
  });
  assert.deepEqual(result, { launched: true, method: "darwin-auto-install" });
  assert.equal(written.length, 1);
  assert.equal(written[0]!.path, `/tmp/handoff/${MACOS_HANDOFF_COMMAND_NAME}`);
  assert.equal(written[0]!.mode, 0o755);
  assert.ok(written[0]!.data.startsWith("#!/bin/bash"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "/bin/bash");
  assert.deepEqual(
    [...calls[0]!.args],
    [`/tmp/handoff/${MACOS_HANDOFF_COMMAND_NAME}`],
  );
  assert.equal(calls[0]!.options?.detached, true);
});

test("macOS hand-off opens the image when the script cannot be armed", async () => {
  const { calls, spawnFn } = recordingSpawn();
  const result = await handOffInstaller({
    platform: "darwin",
    installerPath: macInstallerPath,
    appExecutablePath: macAppExecutable,
    tempDirectory: "/tmp/handoff",
    writeFileFn: async () => {
      throw new Error("read-only volume");
    },
    spawnFn,
  });
  assert.deepEqual(result, { launched: true, method: "darwin-open" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.command, "/usr/bin/open");
  assert.deepEqual([...calls[0]!.args], [macInstallerPath]);
});

test("macOS hand-off opens the image when the app is not inside a bundle", async () => {
  const { calls, spawnFn } = recordingSpawn();
  const result = await handOffInstaller({
    platform: "darwin",
    installerPath: macInstallerPath,
    appExecutablePath: "/usr/local/bin/aitracker",
    spawnFn,
  });
  assert.deepEqual(result, { launched: true, method: "darwin-open" });
  assert.equal(calls[0]!.command, "/usr/bin/open");
});

test("a spawning failure reports the reason without throwing", async () => {
  const result = await handOffInstaller({
    platform: "linux",
    installerPath: "/tmp/aitracker.AppImage",
    spawnFn: () => {
      throw new Error("ENOENT");
    },
  });
  assert.deepEqual(result, { launched: false, reason: "ENOENT" });
});
