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
