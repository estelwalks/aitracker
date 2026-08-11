import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  classifyDashboardProjectRef,
  classifyDashboardProjectRefs,
} from "./project-classification.server.ts";

test("dashboard project classification keeps only locally evidenced workspaces", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "trusttools-dashboard-project-"));
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
    label: "prototype",
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
