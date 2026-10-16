import { readFileSync } from "node:fs";

/**
 * Which distro package family this host installs.
 *
 * Why this exists: a build installed from a `.deb`/`.rpm` updates through its
 * own software centre, and that centre can only open the format its package
 * manager understands. Handing a Debian host a `.rpm` (or the reverse) opens
 * nothing useful, so the updater has to know which artifact to download.
 *
 * `/etc/os-release` is the cheapest reliable signal. Asking the package
 * database would mean a subprocess per candidate, and it cannot answer the
 * question on its own either: the app only knows that it *was* installed from a
 * distro package (its executable sits under `/opt` or `/usr/lib`), not which
 * package manager put it there.
 *
 * `null` means "not recognised", which deliberately keeps the previous
 * behaviour: the AppImage is preferred and the user finishes the install by
 * running it. Guessing wrong here would download a package nothing can open.
 */
export type LinuxPackageFormat = "deb" | "rpm";

/** Distro IDs, and `ID_LIKE` values, whose software centres install `.deb`. */
const DEB_LIKE = new Set([
  "debian",
  "ubuntu",
  "kali",
  "linuxmint",
  "mint",
  "pop",
  "raspbian",
  "elementary",
  "zorin",
  "neon",
  "devuan",
  "parrot",
  "deepin",
]);

/** The same for `.rpm`. */
const RPM_LIKE = new Set([
  "rhel",
  "fedora",
  "centos",
  "rocky",
  "almalinux",
  "alma",
  "opensuse",
  "opensuse-leap",
  "opensuse-tumbleweed",
  "sles",
  "sled",
  "amzn",
  "oracle",
  "virtuozzo",
  "scientific",
]);

/**
 * Parse `ID` and `ID_LIKE` out of an os-release document.
 *
 * Both keys are read because neither is sufficient alone: Kali sets
 * `ID=kali`/`ID_LIKE=debian`, Fedora sets only `ID=fedora`. Values may be
 * quoted, and `ID_LIKE` is a space-separated list. `ID` is examined before
 * `ID_LIKE`, so a host that declares both families resolves to the one it
 * actually is.
 */
export function resolveLinuxPackageFormat(
  osRelease: string,
): LinuxPackageFormat | null {
  const ids: string[] = [];
  for (const line of osRelease.split(/\r?\n/u)) {
    const match = /^\s*(?:ID|ID_LIKE)\s*=\s*(.*?)\s*$/u.exec(line);
    if (!match) continue;
    const value = (match[1] ?? "").replace(/^["']|["']$/gu, "");
    for (const token of value.split(/\s+/u)) {
      const id = token.trim().toLowerCase();
      if (id.length > 0) ids.push(id);
    }
  }
  for (const id of ids) {
    if (DEB_LIKE.has(id)) return "deb";
    if (RPM_LIKE.has(id)) return "rpm";
  }
  return null;
}

/**
 * Read the host's package family. Anything unreadable or unrecognised resolves
 * to `null`: an update must not fail because a distro is new, and the AppImage
 * remains a correct answer for every Linux host.
 */
export function detectLinuxPackageFormat(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly osReleasePath?: string;
    readonly readFileFn?: (path: string) => string;
  } = {},
): LinuxPackageFormat | null {
  if ((options.platform ?? process.platform) !== "linux") return null;
  const read =
    options.readFileFn ?? ((path: string) => readFileSync(path, "utf8"));
  try {
    return resolveLinuxPackageFormat(
      read(options.osReleasePath ?? "/etc/os-release"),
    );
  } catch {
    return null;
  }
}
