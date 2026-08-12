import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APP_DATA_DIR, ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "../../app/composition.server.ts";
import { SystemClock } from "../../platform/persistence/clock.ts";
import { NodeAtomicJsonStore } from "../../platform/persistence/infrastructure/node-atomic-json-store.ts";
import { SKILL_AGENTS } from "../../lib/local-skills/types.ts";
import type { AIExecutionResult } from "../ai-orchestration/contracts.ts";
import type { CandidateOutput } from "./contracts.ts";
import {
  DEFAULT_DISTILL_CANDIDATE_FILE,
  createAtomicCandidateStore,
  distillCandidateStoreSchema,
} from "./infrastructure/atomic-candidate-store.ts";
import { loadDistillation, saveCandidateAsSkill } from "./api.server.ts";

const execution = (): AIExecutionResult => ({
  summary: {
    requestId: "distill:req-1",
    modelId: "model-a",
    providerId: "provider-a",
    promptVersionId: "distillation.summary",
    promptVersion: 1,
    status: "completed",
    cost: { confidence: "estimated", currency: "USD", reason: "estimated" },
    usedFallback: false,
  },
  response: {
    providerId: "provider-a",
    modelId: "model-a",
    text: "Distilled knowledge note.",
  },
});

const candidate = (
  id: string,
  state: CandidateOutput["approvalState"] = "waiting-approval",
): CandidateOutput => ({
  candidateId: id,
  kind: "memory",
  title: "Distilled summary (2 sessions)",
  summary: "Distilled knowledge note.",
  mode: "model",
  approvalState: state,
  selectedSessionRefs: [
    { source: "codex", sessionId: "s1" },
    { source: "codex", sessionId: "s2" },
  ],
  generatedAt: "2026-08-07T00:01:00.000Z",
  execution: execution().summary,
});

async function seedStore(dir: string, candidates: CandidateOutput[]) {
  const filePath = join(
    dir,
    APP_DATA_DIR,
    "tasks",
    "distill-candidates.v1.json",
  );
  // The file lock requires the parent directory to exist before the first write.
  await mkdir(dirname(filePath), { recursive: true });
  const store = new NodeAtomicJsonStore({
    filePath,
    defaultValue: DEFAULT_DISTILL_CANDIDATE_FILE,
    schema: distillCandidateStoreSchema(),
    clock: new SystemClock(),
  });
  const persistence = createAtomicCandidateStore({ store });
  for (const item of candidates) await persistence.save(item);
}

async function withIsolatedRoot<T>(
  fn: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `${TEST_TMP_PREFIX}distill-api-${randomUUID()}-`),
  );
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    return await fn(dir);
  } finally {
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadDistillation returns an empty but honest read model on a fresh root", async () => {
  await withIsolatedRoot(async () => {
    const view = await loadDistillation("zh-CN");
    assert.deepEqual(view.candidates, []);
    assert.equal(view.stats.runs, 0);
    assert.equal(view.stats.approved, 0);
    assert.ok(view.modelOptions.some((m) => m.id === "offline"));
  });
});

test("loadDistillation hydrates the complete persisted candidate history and reports counters", async () => {
  await withIsolatedRoot(async (dir) => {
    await seedStore(dir, [
      candidate("candidate-1", "waiting-approval"),
      candidate("candidate-2", "approved"),
      candidate("candidate-3", "cancelled"),
    ]);
    const view = await loadDistillation("zh-CN");
    assert.equal(view.candidates.length, 3);
    assert.deepEqual(
      new Set(
        view.candidates.map((item) => [item.candidateId, item.approvalState]),
      ),
      new Set([
        ["candidate-1", "waiting-approval"],
        ["candidate-2", "approved"],
        ["candidate-3", "cancelled"],
      ]),
    );
    assert.equal(view.stats.runs, 3);
    assert.equal(view.stats.approved, 1);
  });
});

test("saveCandidateAsSkill writes the approved note into the target agent skill root", async () => {
  await withIsolatedRoot(async (dir) => {
    await seedStore(dir, [candidate("candidate-1", "approved")]);
    const agent = SKILL_AGENTS[0];
    const result = await saveCandidateAsSkill({
      candidateId: "candidate-1",
      skillName: "my-distilled-skill",
      targetAgent: agent,
    });
    if (!result.ok || !result.path) {
      assert.fail(`expected a successful save, got ${JSON.stringify(result)}`);
    }
    const skillPath = result.path;
    const content = await readFile(skillPath, "utf8");
    assert.match(content, /name: my-distilled-skill/);
    assert.ok(
      skillPath.startsWith(join(dir, APP_DATA_DIR)) ||
        skillPath.startsWith(join(dir, ".claude")),
    );
  });
});

test("saveCandidateAsSkill refuses non-approved candidates, traversal names and duplicates", async () => {
  await withIsolatedRoot(async (dir) => {
    const agent = SKILL_AGENTS[0];

    // Not approved.
    await seedStore(dir, [candidate("candidate-1", "waiting-approval")]);
    const notApproved = await saveCandidateAsSkill({
      candidateId: "candidate-1",
      skillName: "skill-a",
      targetAgent: agent,
    });
    assert.equal(notApproved.ok, false);
    assert.equal(notApproved.errorCode, "errors.distillation.notApproved");

    // Approved but traversal name. Rebuild the root so the new store state is
    // hydrated before the next action.
    await seedStore(dir, [
      { ...candidate("candidate-1", "approved"), candidateId: "candidate-2" },
    ]);
    resetCompositionRootForTests();
    const traversal = await saveCandidateAsSkill({
      candidateId: "candidate-2",
      skillName: "../escape",
      targetAgent: agent,
    });
    assert.equal(traversal.ok, false);
    assert.equal(traversal.errorCode, "errors.distillation.invalidName");

    // Duplicate name after a successful write.
    const first = await saveCandidateAsSkill({
      candidateId: "candidate-2",
      skillName: "skill-a",
      targetAgent: agent,
    });
    assert.equal(first.ok, true);
    const duplicate = await saveCandidateAsSkill({
      candidateId: "candidate-2",
      skillName: "skill-a",
      targetAgent: agent,
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.errorCode, "errors.distillation.skillExists");
  });
});

test("saveCandidateAsSkill rejects unknown target agents", async () => {
  await withIsolatedRoot(async (dir) => {
    await seedStore(dir, [candidate("candidate-1", "approved")]);
    const result = await saveCandidateAsSkill({
      candidateId: "candidate-1",
      skillName: "skill-b",
      targetAgent: "Not a real tool",
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "errors.distillation.invalidAgent");
  });
});

test("composition root remains constructible after distillation persistence wiring", async () => {
  await withIsolatedRoot(async () => {
    const root = await getCompositionRoot();
    assert.ok(root.distillation, "distillation application must be assembled");
    assert.deepEqual(await root.distillation.listWaiting(), []);
    assert.deepEqual(await root.distillation.listAll(), []);
  });
});
