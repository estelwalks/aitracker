import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, win32 } from "node:path";
import test from "node:test";

import { APP_ID } from "../../lib/app-config.ts";
import {
  classifyDashboardProjectRef,
  classifyDashboardProjectRefs,
  normaliseProjectRefFor,
  pathImplForPlatform,
} from "./project-classification.server.ts";

test("dashboard project classification keeps only locally evidenced workspaces", async (t) => {
  const home = await mkdtemp(join(tmpdir(), `${APP_ID}-dashboard-project-`));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const workspace = join(home, "real-project");
  const nestedWorkspace = join(workspace, "src", "feature");
  const nestedPackage = join(workspace, "prototype");
  const quickConversation = join(home, "scratch-chat");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(nestedWorkspace, { recursive: true });
  await mkdir(nestedPackage, { recursive: true });
  await writeFile(join(nestedPackage, "package.json"), "{}");
  await mkdir(quickConversation, { recursive: true });
  await writeFile(join(quickConversation, "notes.txt"), "no workspace marker");

  assert.deepEqual(
    await classifyDashboardProjectRef(nestedWorkspace, { home }),
    {
      kind: "workspace",
      label: "real-project",
    },
  );
  assert.deepEqual(
    await classifyDashboardProjectRef(quickConversation, { home }),
    {
      kind: "quick-conversation",
      label: "quick-conversation",
    },
  );
  assert.deepEqual(await classifyDashboardProjectRef(nestedPackage, { home }), {
    kind: "workspace",
    label: "real-project",
  });
  assert.deepEqual(
    await classifyDashboardProjectRef(join(home, "removed"), { home }),
    {
      kind: "unknown",
      label: "unknown",
    },
  );

  const all = await classifyDashboardProjectRefs(
    [nestedWorkspace, quickConversation, nestedWorkspace],
    { home },
  );
  assert.equal(all.size, 2);
  assert.equal(all.get(nestedWorkspace)?.kind, "workspace");
});

test("a marker deep inside the cwd tree still makes it a workspace (e.g. Codex work dirs)", async (t) => {
  const home = await mkdtemp(join(tmpdir(), `${APP_ID}-dashboard-subtree-`));
  t.after(async () => rm(home, { recursive: true, force: true }));
  // The cwd itself has no marker; a nested sub-project has one.
  const workDir = join(home, "cnnc-style-workdir");
  const nestedProject = join(workDir, "extensions", "packages", "ai-writer");
  await mkdir(nestedProject, { recursive: true });
  await writeFile(join(nestedProject, "package.json"), "{}");
  // A scratch dir with plain files and no marker anywhere stays quick-conversation.
  const scratch = join(home, "aipywork", "133");
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, "task.json"), "{}");

  assert.deepEqual(await classifyDashboardProjectRef(workDir, { home }), {
    kind: "workspace",
    label: "cnnc-style-workdir",
  });
  assert.deepEqual(await classifyDashboardProjectRef(scratch, { home }), {
    kind: "quick-conversation",
    label: "quick-conversation",
  });
});

test("git worktree/submodule .git files (gitdir:) count as workspace markers", async (t) => {
  const home = await mkdtemp(join(tmpdir(), `${APP_ID}-dashboard-worktree-`));
  t.after(async () => rm(home, { recursive: true, force: true }));

  // Real worktree shape: the checkout has a `.git` FILE pointing at a git
  // directory elsewhere (absolute and relative gitdir: forms).
  const mainRepo = join(home, "main-repo", ".git");
  await mkdir(join(mainRepo, "worktrees"), { recursive: true });
  const worktree = join(home, "worktrees", "feature-branch");
  await mkdir(worktree, { recursive: true });
  await mkdir(join(mainRepo, "worktrees", "feature-branch"), {
    recursive: true,
  });
  await writeFile(
    join(worktree, ".git"),
    `gitdir: ${join(mainRepo, "worktrees", "feature-branch")}\n`,
  );
  // Submodule shape: relative gitdir pointing into the parent's .git/modules.
  const submodule = join(home, "vendor", "submodule");
  await mkdir(submodule, { recursive: true });
  await mkdir(join(mainRepo, "modules", "submodule"), { recursive: true });
  await writeFile(
    join(submodule, ".git"),
    "gitdir: ../../main-repo/.git/modules/submodule\n",
  );

  assert.deepEqual(await classifyDashboardProjectRef(worktree, { home }), {
    kind: "workspace",
    label: "feature-branch",
  });
  assert.deepEqual(await classifyDashboardProjectRef(submodule, { home }), {
    kind: "workspace",
    label: "submodule",
  });

  // A stale worktree pointer (target removed) and a fake .git file are NOT
  // valid repositories; with no other marker they stay quick-conversation.
  const stale = join(home, "stale-worktree");
  await mkdir(stale, { recursive: true });
  await writeFile(join(stale, ".git"), "gitdir: C:/does/not/exist\n");
  const fake = join(home, "fake-git-file");
  await mkdir(fake, { recursive: true });
  await writeFile(join(fake, ".git"), "this is not a gitdir line\n");
  for (const dir of [stale, fake]) {
    assert.deepEqual(await classifyDashboardProjectRef(dir, { home }), {
      kind: "quick-conversation",
      label: "quick-conversation",
    });
  }
});

test("win32 semantics: drive-letter absolute paths are recognized (cross-platform)", async (t) => {
  // Pure path-form matrix — verifiable on any host, no filesystem probes.
  assert.equal(
    normaliseProjectRefFor(win32, "D:\\Dev\\trusttools_webapp", "C:\\Users\\u"),
    "D:\\Dev\\trusttools_webapp",
  );
  assert.equal(
    normaliseProjectRefFor(win32, "D:/Dev/trusttools_webapp", "C:/Users/u"),
    "D:\\Dev\\trusttools_webapp",
  );
  assert.equal(
    normaliseProjectRefFor(win32, "~/work/app", "C:\\Users\\u"),
    "C:\\Users\\u\\work\\app",
  );
  assert.equal(
    normaliseProjectRefFor(win32, "~", "C:\\Users\\u"),
    "C:\\Users\\u",
  );
  // A drive-letter string is NOT absolute under posix semantics.
  assert.equal(
    normaliseProjectRefFor(posix, "D:/Dev/trusttools_webapp", "/home/u"),
    null,
  );
  assert.equal(
    normaliseProjectRefFor(posix, "/home/u/work", "/home/u"),
    "/home/u/work",
  );
  assert.equal(
    normaliseProjectRefFor(win32, "relative/proj", "C:\\Users\\u"),
    null,
  );
  assert.equal(normaliseProjectRefFor(win32, "unknown", "C:\\Users\\u"), null);

  // Full classification with explicit win32 semantics: on a Windows host the
  // real directory resolves to a workspace; elsewhere the drive-letter path
  // cannot exist, so the honest result is unknown (never a misclassification).
  const home = await mkdtemp(join(tmpdir(), `${APP_ID}-dashboard-win32-`));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const realWorkspace = join(home, "win-proj");
  await mkdir(join(realWorkspace, ".git"), { recursive: true });
  const result = await classifyDashboardProjectRef(realWorkspace, {
    home,
    platform: "win32",
  });
  if (process.platform === "win32") {
    assert.deepEqual(result, { kind: "workspace", label: "win-proj" });
  } else {
    // normalize() under win32 semantics produces "X:\..." which cannot exist
    // on this host; classification must degrade to unknown, never crash.
    assert.equal(result.kind, "unknown");
  }
});

test("posix semantics: external absolute paths classify when they exist (cross-platform)", async (t) => {
  const home = await mkdtemp(join(tmpdir(), `${APP_ID}-dashboard-posix-`));
  t.after(async () => rm(home, { recursive: true, force: true }));
  const external = join(home, "..", "posix-external-proj");
  await mkdir(join(external, ".git"), { recursive: true });
  const result = await classifyDashboardProjectRef(external, {
    home,
    platform: "linux",
  });
  // posix semantics never treat a drive-letter path as absolute.
  assert.deepEqual(
    await classifyDashboardProjectRef("D:/Dev/proj", {
      home,
      platform: "linux",
    }),
    { kind: "unknown", label: "unknown" },
  );
  assert.equal(pathImplForPlatform("win32"), win32);
  assert.equal(pathImplForPlatform("darwin"), posix);
  assert.equal(pathImplForPlatform("linux"), posix);
  void result;
});
