import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { APP_DATA_DIR, ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "../../app/composition.server.ts";
import { SKILL_AGENTS } from "../../lib/local-skills/types.ts";
import type { AIExecutionResult } from "../ai-orchestration/contracts.ts";
import type { CandidateOutput } from "./contracts.ts";
import type { SessionSummary } from "../sessions/contracts.ts";
import {
  loadDistillation,
  saveCandidateAsSkill,
  startDistillation,
} from "./api.server.ts";

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
  execution: { ...execution().summary, requestId: `distill:req-${id}` },
});

async function seedStore(_dir: string, candidates: CandidateOutput[]) {
  const root = await getCompositionRoot();
  const persistence = root.database.features.candidates;
  for (const item of candidates) await persistence.save(item);
  await root.scheduler.stop();
  resetCompositionRootForTests();
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
    await getCompositionRoot();
    return await fn(dir);
  } finally {
    await new Promise<void>((resolve) => setImmediate(resolve));
    await (await getCompositionRoot()).scheduler.stop();
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
    assert.deepEqual(view.modelOptions, [
      { id: "offline", label: "offline", offline: true },
    ]);
    assert.equal(view.activeModelId, "offline");
    // B-600: the server-side quota ledger is always projected; a fresh root
    // reports zero used calls against the configured daily limit.
    assert.ok(view.quota, "quota projection must be present");
    assert.equal(view.quota.used, 0);
    assert.equal(view.quota.limit, 20);
    assert.equal(view.quota.remaining, 20);
  });
});

test("configured profile is selected automatically and starts through the profile provider", async () => {
  await withIsolatedRoot(async () => {
    const root = await getCompositionRoot();
    const profile = await root.modelProfiles.upsert({
      mode: "custom",
      name: "Test profile",
      protocol: "openai",
      endpoint: "https://models.example.test/v1",
      model: "test-model",
      apiKey: "test-api-key",
    });
    const activated = await root.modelProfiles.setActive(profile.id);
    assert.equal(activated.ok, true);
    const view = await loadDistillation("zh-CN");
    assert.equal(view.activeModelId, profile.id);
    assert.ok(view.modelOptions.some((item) => item.id === profile.id));
    assert.ok(!view.modelOptions.some((item) => item.id === "default"));

    let request: { modelId: string; providerId?: string } | undefined;
    const originalStart = root.distillation.start;
    root.distillation.start = async (input) => {
      request = { modelId: input.modelId, providerId: input.providerId };
      return {
        ok: true,
        value: {
          requestId: "distill:test",
          status: "waiting-approval",
          candidate: candidate("run-1"),
        },
      };
    };
    try {
      const result = await startDistillation({ sessionRefs: [] });
      assert.equal(result.ok, true);
      assert.deepEqual(request, { modelId: profile.id, providerId: "profile" });
    } finally {
      root.distillation.start = originalStart;
    }
  });
});

test("distillation uses the active profile endpoint and API key for a real run", async () => {
  await withIsolatedRoot(async () => {
    let receivedBody = "";
    let receivedAuth = "";
    const server = createServer((req: IncomingMessage, res) => {
      receivedAuth = String(req.headers.authorization ?? "");
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        receivedBody = raw;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "Distilled knowledge note." } }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const root = await getCompositionRoot();
      const profile = await root.modelProfiles.upsert({
        name: "distillation-integration-profile",
        mode: "custom",
        protocol: "openai",
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: "distillation-test-model",
        apiKey: "sk-distillation-123456",
      });
      assert.equal((await root.modelProfiles.setActive(profile.id)).ok, true);

      const session: SessionSummary = {
        sessionId: "s1",
        source: "codex",
        title: "Integration session",
        projectKey: "demo",
        model: "source-model",
        startedAt: "2026-08-07T00:00:00.000Z",
        endedAt: "2026-08-07T00:01:00.000Z",
        durationMs: 60_000,
        turns: 1,
        editTurns: 0,
        retryTurns: 0,
        totals: {
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 2,
        },
        cost: {
          knownUsd: 0,
          estimatedUsd: 0,
          cacheSavingsUsd: 0,
          pricedEvents: 0,
          estimatedEvents: 0,
          unknownEvents: 0,
          unknownModels: [],
          complete: true,
        },
        subagentCalls: 0,
        status: "available",
        statusReason: null,
        resumeAvailable: true,
      };
      const originalQuery = root.sessions.query;
      root.sessions.query = async () => ({
        ok: true as const,
        value: {
          generatedAt: new Date().toISOString(),
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
          sessions: [session],
        },
      });
      try {
        const result = await root.distillation.start({
          requestId: "distill:integration",
          selection: { sessionRefs: [{ source: "codex", sessionId: "s1" }] },
          modelId: profile.id,
          providerId: "profile",
          kind: "memory",
          prompt: {
            id: "distillation.memory",
            version: 2,
            template: "Return a concise knowledge note.",
          },
        });
        assert.equal(result.ok, true);
        const payload = JSON.parse(receivedBody) as {
          model?: string;
          messages?: Array<{ content?: string }>;
        };
        assert.equal(receivedAuth, "Bearer sk-distillation-123456");
        assert.equal(payload.model, "distillation-test-model");
        assert.match(payload.messages?.[0]?.content ?? "", /knowledge note/);
      } finally {
        root.sessions.query = originalQuery;
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
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
    await seedStore(dir, [candidate("candidate-2", "approved")]);
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
