import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";

import {
  canonicalizeProjectPathDetailsFor,
  canonicalizeProjectPathFor,
} from "./project-path.server.ts";
import {
  isTccProtectedPathFor,
  normalizeProjectPathFor,
} from "./project-path.ts";

test("win32: home itself becomes ~", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\Users\\u", "C:\\Users\\u"),
    "~",
  );
});

test("posix: home itself becomes ~", () => {
  assert.equal(normalizeProjectPathFor(posix, "/home/u", "/home/u"), "~");
});

test("win32: paths under home become ~/relative with forward slashes", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\Users\\u\\work\\app", "C:\\Users\\u"),
    "~/work/app",
  );
  // Forward-slash input is normalized the same way.
  assert.equal(
    normalizeProjectPathFor(win32, "C:/Users/u/work/app", "C:/Users/u"),
    "~/work/app",
  );
});

test("posix: paths under home become ~/relative", () => {
  assert.equal(
    normalizeProjectPathFor(posix, "/home/u/work/app", "/home/u"),
    "~/work/app",
  );
});

test("win32: cross-drive absolute paths keep their absolute form (regression)", () => {
  // win32.relative("C:\\Users\\u", "D:\\Dev\\app") returns "D:\\Dev\\app"
  // itself; prefixing ~/ would mangle it into "~/D:/Dev/app" and hide the
  // project from the dashboard overview.
  assert.equal(
    normalizeProjectPathFor(win32, "D:\\Dev\\aitracker_webapp", "C:\\Users\\u"),
    "D:\\Dev\\aitracker_webapp",
  );
  assert.equal(
    normalizeProjectPathFor(win32, "D:/Dev/aitracker_webapp", "C:/Users/u"),
    "D:/Dev/aitracker_webapp",
  );
});

test("win32: external absolute paths on the same drive keep their absolute form", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "C:\\opt\\external", "C:\\Users\\u"),
    "C:\\opt\\external",
  );
});

test("posix: external absolute paths keep their absolute form", () => {
  assert.equal(
    normalizeProjectPathFor(posix, "/opt/external", "/home/u"),
    "/opt/external",
  );
});

test("posix: parent-of-home paths keep their absolute form", () => {
  assert.equal(normalizeProjectPathFor(posix, "/home", "/home/u"), "/home");
});

test("relative paths pass through untouched on both implementations", () => {
  assert.equal(
    normalizeProjectPathFor(win32, "relative/proj", "C:\\Users\\u"),
    "relative/proj",
  );
  assert.equal(
    normalizeProjectPathFor(posix, "relative/proj", "/home/u"),
    "relative/proj",
  );
  assert.equal(
    normalizeProjectPathFor(win32, "unknown", "C:\\Users\\u"),
    "unknown",
  );
});

test("canonicalizes home/absolute path variants to one Git repository identity", async (t) => {
  // Exercises the POSIX path implementation against the real filesystem; on
  // Windows the fixture paths are drive-less and would be reinterpreted as
  // root-relative. The POSIX behavior is covered on the Linux CI runner.
  if (process.platform === "win32") {
    t.skip("POSIX filesystem fixture is not representable on Windows");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "aitracker-project-path-"));
  const homeDirectory = join(root, "home");
  const repositoryRoot = join(homeDirectory, "Documents", "Dev", "repo");
  const nestedDirectory = join(repositoryRoot, "src", "feature");
  try {
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(nestedDirectory, { recursive: true });

    // `linux` is passed explicitly so this stays a cross-platform contract
    // test: the darwin guard deliberately skips the disk probe for this
    // fixture, and that behavior has its own test below.
    const absolute = await canonicalizeProjectPathFor(
      posix,
      `${nestedDirectory}/../feature/`,
      homeDirectory,
      "linux",
    );
    const homeRelative = await canonicalizeProjectPathFor(
      posix,
      "~/Documents/Dev/repo/src/feature",
      homeDirectory,
      "linux",
    );

    assert.equal(absolute, "~/Documents/Dev/repo");
    assert.equal(homeRelative, absolute);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves non-path project markers for later classification", async () => {
  assert.equal(
    await canonicalizeProjectPathFor(posix, "quick-conversation", "/home/u"),
    "quick-conversation",
  );
  assert.equal(
    await canonicalizeProjectPathFor(posix, "unknown", "/home/u"),
    "unknown",
  );
});

test("darwin: classifies TCC-protected directories lexically", () => {
  const home = "/Users/u";

  for (const protectedPath of [
    "/Users/u/Documents",
    "/Users/u/Documents/Dev/repo",
    "/Users/u/Desktop/notes",
    "/Users/u/Downloads/archive.zip",
    "/Users/u/Library/CloudStorage/Dropbox/proj",
    "/Users/u/Library/Mobile Documents/com~apple~CloudDocs/proj",
    "/Volumes/Work/proj",
    // macOS resolves its own volumes case-insensitively, so a differently
    // cased path still reaches the protected directory.
    "/users/u/documents/Dev/repo",
  ]) {
    assert.equal(
      isTccProtectedPathFor(posix, protectedPath, home, "darwin"),
      true,
      protectedPath,
    );
  }

  for (const openPath of [
    // Home itself is readable without consent…
    "/Users/u",
    // …and so is everything outside the gated set. `DocumentsArchive` must not
    // match `Documents` (the check compares whole path segments).
    "/Users/u/Dev/repo",
    "/Users/u/DocumentsArchive/repo",
    "/Users/u/Library/Application Support/AITracker",
    "/opt/work/repo",
  ]) {
    assert.equal(
      isTccProtectedPathFor(posix, openPath, home, "darwin"),
      false,
      openPath,
    );
  }

  // Linux and Windows have no per-directory consent gate, so nothing is
  // withheld from disk resolution there.
  for (const platform of ["linux", "win32"] as const) {
    assert.equal(
      isTccProtectedPathFor(
        posix,
        "/Users/u/Documents/Dev/repo",
        home,
        platform,
      ),
      false,
      platform,
    );
  }
});

test("darwin: classifies protected directories with Windows path semantics", () => {
  // The helper stays parameterized over the path implementation so the
  // classification is verifiable on any host, even though only darwin
  // consults it.
  assert.equal(
    isTccProtectedPathFor(
      win32,
      "C:\\Users\\u\\Documents\\proj",
      "C:\\Users\\u",
      "darwin",
    ),
    true,
  );
  assert.equal(
    isTccProtectedPathFor(
      win32,
      "C:\\Users\\u\\Dev\\proj",
      "C:\\Users\\u",
      "darwin",
    ),
    false,
  );
});

test("darwin: never resolves a project inside a protected directory", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX filesystem fixture is not representable on Windows");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "aitracker-project-path-tcc-"));
  const homeDirectory = join(root, "home");
  const repositoryRoot = join(homeDirectory, "Documents", "Dev", "repo");
  const nestedDirectory = join(repositoryRoot, "src", "feature");
  try {
    await mkdir(join(repositoryRoot, ".git"), { recursive: true });
    await mkdir(nestedDirectory, { recursive: true });

    // On darwin the guard fires before any filesystem call: the nested cwd
    // keeps its lexical identity instead of collapsing onto the repository
    // root, and the project is reported as non-Git. Resolving it would raise
    // the "…would like to access files in your Documents folder" prompt.
    assert.equal(
      await canonicalizeProjectPathFor(
        posix,
        nestedDirectory,
        homeDirectory,
        "darwin",
      ),
      "~/Documents/Dev/repo/src/feature",
    );
    assert.deepEqual(
      await canonicalizeProjectPathDetailsFor(
        posix,
        nestedDirectory,
        homeDirectory,
        "darwin",
      ),
      { project: "~/Documents/Dev/repo/src/feature", isGitProject: false },
    );

    // Control: the identical fixture on a platform without a TCC gate still
    // collapses onto the repository root, so the darwin result above comes
    // from the guard and not from a broken fixture.
    assert.equal(
      await canonicalizeProjectPathFor(
        posix,
        nestedDirectory,
        homeDirectory,
        "linux",
      ),
      "~/Documents/Dev/repo",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
