import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  desktopEntryExec,
  linuxAutostartEntryContent,
  linuxAutostartEntryPath,
  LINUX_AUTOSTART_FILENAME,
  probeLinuxAutostartSupported,
  resolveAutostartExecPath,
  readLinuxAutostartEnabled,
  resolveXdgConfigHome,
  writeLinuxAutostartEnabled,
  type LinuxAutostartDependencies,
} from "./linux-autostart.js";

const HOME = "/home/analyst";
const PROGRAM = "/opt/AITracker/aitracker";

function options(env: Record<string, string | undefined> = {}) {
  return { env, homeDirectory: HOME, execPath: PROGRAM };
}

/** Records every filesystem call so the entry content can be asserted. */
function recordingFileSystem() {
  const writes: Array<{ path: string; data: string }> = [];
  const directories: string[] = [];
  const removals: Array<{ path: string; force: boolean }> = [];
  const dependencies: LinuxAutostartDependencies = {
    writeFile: async (path, data) => {
      writes.push({ path, data });
    },
    makeDirectory: async (path, settings) => {
      directories.push(`${path}${settings?.recursive ? " (recursive)" : ""}`);
    },
    removeFile: async (path, settings) => {
      removals.push({ path, force: settings?.force === true });
    },
  };
  return { writes, directories, removals, dependencies };
}

test("the autostart entry lives under $XDG_CONFIG_HOME when it is absolute", () => {
  assert.equal(
    resolveXdgConfigHome({ XDG_CONFIG_HOME: "/data/config" }, HOME),
    "/data/config",
  );
  assert.equal(
    linuxAutostartEntryPath({ XDG_CONFIG_HOME: "/data/config" }, HOME),
    join("/data/config", "autostart", LINUX_AUTOSTART_FILENAME),
  );
});

test("a missing, blank or relative XDG_CONFIG_HOME falls back to ~/.config", () => {
  for (const env of [
    {},
    { XDG_CONFIG_HOME: "" },
    { XDG_CONFIG_HOME: "   " },
    // The XDG specification requires ignoring a relative value.
    { XDG_CONFIG_HOME: "config" },
    { XDG_CONFIG_HOME: "./config" },
  ]) {
    assert.equal(resolveXdgConfigHome(env, HOME), join(HOME, ".config"));
  }
});

test("the entry content is a valid Desktop Entry that enables the app", () => {
  assert.equal(
    linuxAutostartEntryContent({ exec: desktopEntryExec(PROGRAM) }),
    [
      "[Desktop Entry]",
      "Type=Application",
      "Name=AITracker",
      `Exec="${PROGRAM}"`,
      "Terminal=false",
      "X-GNOME-Autostart-enabled=true",
      "",
    ].join("\n"),
  );
});

test("spaces in the executable path and arguments stay one token each", () => {
  assert.equal(
    desktopEntryExec("/home/my user/Apps/AITracker", ["/home/my user/app"]),
    '"/home/my user/Apps/AITracker" "/home/my user/app"',
  );
  // A double quote has no escape inside a Desktop Entry value; refusing is
  // better than writing an entry that cannot start the application.
  assert.throws(() => desktopEntryExec('/opt/we"ird/app'), /quote/u);
});

test("enabling writes the entry and creates the autostart directory", async () => {
  const fs = recordingFileSystem();
  assert.equal(
    await writeLinuxAutostartEnabled(true, options(), fs.dependencies),
    true,
  );
  assert.deepEqual(fs.directories, [
    join(HOME, ".config", "autostart") + " (recursive)",
  ]);
  assert.equal(fs.writes.length, 1);
  assert.equal(fs.writes[0]?.path, linuxAutostartEntryPath({}, HOME));
  assert.match(fs.writes[0]?.data ?? "", /^\[Desktop Entry\]\n/u);
  assert.match(fs.writes[0]?.data ?? "", new RegExp(`Exec="${PROGRAM}"`, "u"));
  assert.equal(fs.removals.length, 0);
});

test("disabling force-removes the entry without touching the directory", async () => {
  const fs = recordingFileSystem();
  assert.equal(
    await writeLinuxAutostartEnabled(false, options(), fs.dependencies),
    true,
  );
  assert.deepEqual(fs.removals, [
    { path: linuxAutostartEntryPath({}, HOME), force: true },
  ]);
  assert.equal(fs.writes.length, 0);
  assert.equal(fs.directories.length, 0);
});

test("an unwritable config root is reported instead of throwing", async () => {
  const failures: LinuxAutostartDependencies = {
    writeFile: async () => {
      throw new Error("EACCES");
    },
    removeFile: async () => {
      throw new Error("EACCES");
    },
  };
  assert.equal(
    await writeLinuxAutostartEnabled(true, options(), failures),
    false,
  );
  assert.equal(
    await writeLinuxAutostartEnabled(false, options(), failures),
    false,
  );
});

test("an AppImage autostart entry targets $APPIMAGE, not the temp mount", () => {
  // The type-2 runtime runs the payload from /tmp/.mount_XXXX and sets $APPIMAGE
  // to the real file. Using process.execPath would write an entry that points
  // into a directory which is gone by the next login.
  const mount = "/tmp/.mount_AITrac9f2kQa/aitracker";
  const image = "/home/analyst/Applications/AITracker-Linux-x64.AppImage";
  assert.equal(
    resolveAutostartExecPath({ env: { APPIMAGE: image }, execPath: mount }),
    image,
  );
  // A relative or blank $APPIMAGE is ignored rather than trusted — and because
  // the process is then still running out of the mount, there is no stable
  // executable at all and the answer is null rather than the transient path.
  for (const value of [
    undefined,
    "",
    "   ",
    "AITracker.AppImage",
    "./x.AppImage",
  ]) {
    assert.equal(
      resolveAutostartExecPath({ env: { APPIMAGE: value }, execPath: mount }),
      null,
      String(value),
    );
  }

  // The deb/rpm launcher is a real path, so it is used as-is: electron-builder's
  // Linux packages install no /usr/bin symlink, which leaves /opt/... as the
  // only thing an entry could launch.
  assert.equal(
    resolveAutostartExecPath({
      env: {},
      execPath: "/opt/AITracker/aitracker",
    }),
    "/opt/AITracker/aitracker",
  );
});

test("an extracted AppImage payload is refused in both write and probe", async () => {
  // `--appimage-extract-and-run` unpacks to /tmp and leaves $APPIMAGE unset when
  // the environment is filtered, e.g. launched through a wrapper.
  const extracted = "/tmp/appimage_extracted_088b6219/aitracker";
  const extractedOptions = {
    env: {},
    homeDirectory: HOME,
    execPath: extracted,
  };

  const fs = recordingFileSystem();
  assert.equal(
    await writeLinuxAutostartEnabled(true, extractedOptions, fs.dependencies),
    false,
  );
  assert.equal(fs.writes.length, 0, "nothing may be written");
  assert.equal(
    await probeLinuxAutostartSupported(extractedOptions, fs.dependencies),
    false,
    "the switch must report unsupported so the UI hides it",
  );
  assert.equal(fs.writes.length, 0, "the probe must not write either");
});

test("a non-AppImage install still autostarts through process.execPath", async () => {
  const fs = recordingFileSystem();
  await writeLinuxAutostartEnabled(
    true,
    {
      ...options({ APPIMAGE: "/opt/AITracker.AppImage" }),
      execPath: "/usr/bin/aitracker",
    },
    fs.dependencies,
  );
  const written = fs.writes[0]?.data ?? "";
  assert.match(written, /Exec="\/opt\/AITracker\.AppImage"/u);
  assert.doesNotMatch(written, /usr\/bin\/aitracker/u);
});

test("the writability probe never leaves a real autostart entry behind", async () => {
  const fs = recordingFileSystem();
  assert.equal(
    await probeLinuxAutostartSupported(options(), fs.dependencies),
    true,
  );
  assert.equal(fs.writes.length, 1);
  const marker = fs.writes[0]?.path ?? "";
  assert.match(marker, /\.aitracker-autostart-probe$/u);
  assert.notEqual(marker, linuxAutostartEntryPath({}, HOME));
  assert.deepEqual(fs.removals, [{ path: marker, force: true }]);
});

test("the probe reports false when the config root is not writable", async () => {
  assert.equal(
    await probeLinuxAutostartSupported(options(), {
      makeDirectory: async () => {
        throw new Error("EROFS");
      },
    }),
    false,
  );
});

test("readLinuxAutostartEnabled treats a missing entry as disabled", () => {
  assert.equal(
    readLinuxAutostartEnabled(options(), { fileExists: () => false }),
    false,
  );
  assert.equal(
    readLinuxAutostartEnabled(options(), { fileExists: () => true }),
    true,
  );
});

test("an entry that is present but explicitly disabled reads as off", () => {
  const entry = linuxAutostartEntryContent({ exec: desktopEntryExec(PROGRAM) });
  assert.equal(
    readLinuxAutostartEnabled(options(), {
      fileExists: () => true,
      readFileSync: () => entry.replace("enabled=true", "enabled=false"),
    }),
    false,
  );
  assert.equal(
    readLinuxAutostartEnabled(options(), {
      fileExists: () => true,
      readFileSync: () => entry,
    }),
    true,
  );
  assert.equal(
    readLinuxAutostartEnabled(options(), {
      fileExists: () => true,
      readFileSync: () => {
        throw new Error("EIO");
      },
    }),
    false,
  );
});
