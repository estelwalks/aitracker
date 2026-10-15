import assert from "node:assert/strict";
import test from "node:test";

import {
  detectLinuxPackageFormat,
  resolveLinuxPackageFormat,
} from "./linux-package-format.ts";

test("os-release decides which package format a host installs", () => {
  // Kali and Debian-family hosts answer through ID_LIKE, Fedora and RHEL
  // through their own IDs. Both keys are read because neither is enough alone.
  assert.equal(
    resolveLinuxPackageFormat(
      'PRETTY_NAME="Kali GNU/Linux Rolling"\nID=kali\nID_LIKE=debian\n',
    ),
    "deb",
  );
  assert.equal(resolveLinuxPackageFormat("ID=ubuntu\nID_LIKE=debian\n"), "deb");
  assert.equal(resolveLinuxPackageFormat("ID=fedora\n"), "rpm");
  assert.equal(
    resolveLinuxPackageFormat("ID=rocky\nID_LIKE=rhel centos\n"),
    "rpm",
  );
  assert.equal(
    resolveLinuxPackageFormat('ID="opensuse-leap"\nID_LIKE="suse"\n'),
    "rpm",
  );
});

test("an unknown or unreadable host resolves to no preference", () => {
  // `null` keeps the previous behaviour — the AppImage, which every host can
  // run — instead of guessing a package nothing could open.
  assert.equal(resolveLinuxPackageFormat("ID=gentoo\n"), null);
  assert.equal(resolveLinuxPackageFormat("NAME=Whatever\n"), null);
  assert.equal(resolveLinuxPackageFormat(""), null);
  assert.equal(detectLinuxPackageFormat({ platform: "darwin" }), null);
  assert.equal(detectLinuxPackageFormat({ platform: "win32" }), null);
  assert.equal(
    detectLinuxPackageFormat({
      platform: "linux",
      readFileFn: () => {
        throw new Error("ENOENT");
      },
    }),
    null,
  );
});

test("the format is read from the host's own os-release", () => {
  const requested: string[] = [];
  const format = detectLinuxPackageFormat({
    platform: "linux",
    osReleasePath: "/etc/os-release",
    readFileFn: (path) => {
      requested.push(path);
      return 'ID=almalinux\nID_LIKE="rhel centos fedora"\n';
    },
  });
  assert.equal(format, "rpm");
  assert.deepEqual(requested, ["/etc/os-release"]);
});
