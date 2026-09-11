import { posix, win32 } from "node:path";

/**
 * Project-path normalization shared by the usage scanner.
 *
 * Display contract (privacy + readability): the user's home itself becomes
 * "~", paths under the home become "~/<relative>", and everything else keeps
 * its original form — including Windows cross-drive absolute paths
 * (C:\home vs D:\project), external absolute paths, and relative paths.
 *
 * The function is parameterized over a path implementation (`win32` / `posix`)
 * so the Windows cross-drive behavior is verifiable on any host. The default
 * export binds the running platform.
 *
 * Cross-drive subtlety: `win32.relative("C:\\Users\\u", "D:\\Dev\\a")` returns
 * the absolute path "D:\\Dev\\a" itself rather than a ".."-relative segment,
 * so a naive `~/` prefix would mangle it into "~/D:/Dev/a" and drop the
 * project out of the dashboard project overview. `isAbsolute(relativeProject)`
 * detects exactly that case: it is never true for a POSIX relative() result.
 */
export type ProjectPathImpl = typeof win32;

export function normalizeProjectPathFor(
  pathImpl: ProjectPathImpl,
  project: string,
  homeDirectory: string,
): string {
  if (project === homeDirectory) {
    return "~";
  }

  const relativeProject = pathImpl.relative(homeDirectory, project);
  const underHome =
    relativeProject !== ".." &&
    !relativeProject.startsWith(`..${pathImpl.sep}`);
  if (
    pathImpl.isAbsolute(project) &&
    underHome &&
    !pathImpl.isAbsolute(relativeProject)
  ) {
    return `~/${relativeProject.split(pathImpl.sep).join("/")}`;
  }

  return project;
}

const platformPath: ProjectPathImpl =
  process.platform === "win32" ? win32 : posix;

/** Bind {@link normalizeProjectPathFor} to the running platform. */
export function normalizeProjectPath(
  project: string,
  homeDirectory: string,
): string {
  return normalizeProjectPathFor(platformPath, project, homeDirectory);
}

/**
 * Home subdirectories that macOS guards with TCC "Files and Folders", plus the
 * file-provider containers that raise the equivalent cloud-storage prompt.
 *
 * Any filesystem call that reaches into one of them — even a `stat()` of a
 * single `.git` entry — makes the OS interrupt the user with an access
 * prompt. Worse, an ad-hoc signed build cannot keep the resulting grant: the
 * record is keyed to the binary's cdhash, so every rebuild looks like a brand
 * new app and asks again. The scanners only ever *display* these paths and the
 * display contract is home-relative either way, so probing them on disk buys a
 * marginally better project bucket at the price of a permission dialog.
 */
export const TCC_PROTECTED_HOME_DIRECTORIES: readonly string[] = [
  "Desktop",
  "Documents",
  "Downloads",
  "Library/CloudStorage",
  "Library/Mobile Documents",
];

/**
 * Mount points whose volumes carry their own TCC services
 * (`SystemPolicyRemovableVolumes` / `SystemPolicyNetworkVolumes`) and prompt
 * with the same dialog family.
 */
const TCC_PROTECTED_ABSOLUTE_DIRECTORIES: readonly string[] = ["/Volumes"];

/**
 * Case-folded, forward-slashed comparison key. macOS resolves both its own
 * system volume and default APFS/HFS+ data volumes case-insensitively, so
 * `/users/u/documents` reaches the same protected directory as
 * `/Users/u/Documents`.
 */
function protectionKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();
}

/**
 * Whether reading `absolutePath` would cross a macOS TCC boundary.
 *
 * Returns `false` on every other platform: Linux and Windows have no
 * equivalent per-directory consent gate, so the scanners keep resolving those
 * paths on disk. The check is purely lexical — it must never touch the
 * filesystem, because touching it is the very thing being avoided.
 */
export function isTccProtectedPathFor(
  pathImpl: ProjectPathImpl,
  absolutePath: string,
  homeDirectory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "darwin") return false;

  const target = protectionKey(pathImpl.normalize(absolutePath));
  const home = pathImpl.normalize(homeDirectory);
  const roots = [
    ...TCC_PROTECTED_HOME_DIRECTORIES.map((entry) =>
      pathImpl.normalize(pathImpl.join(home, entry)),
    ),
    ...TCC_PROTECTED_ABSOLUTE_DIRECTORIES,
  ];

  return roots.some((root) => {
    const key = protectionKey(root);
    return target === key || target.startsWith(`${key}/`);
  });
}
