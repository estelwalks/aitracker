import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
  setSecretCodecForTests,
} from "../../app/composition.server.ts";
import {
  generateReport,
  getReportBody,
  loadReports,
  saveReportBody,
} from "./api.server.ts";

async function withEnv<T>(
  vars: Readonly<Record<string, string | undefined>>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Isolate composition + profile storage under a fresh temp data root. */
async function withIsolatedRoot<T>(
  fn: (
    root: Awaited<ReturnType<typeof getCompositionRoot>>,
    dataRoot: string,
  ) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `${TEST_TMP_PREFIX}reports-api-${randomUUID()}-`),
  );
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  setSecretCodecForTests({
    async encrypt(plaintext) {
      return {
        ciphertext: new TextEncoder().encode(`test:${plaintext}`),
        encryptionKind: "safe-storage",
      };
    },
    async decrypt(secret) {
      return new TextDecoder().decode(secret.ciphertext).slice("test:".length);
    },
  });
  try {
    const root = await getCompositionRoot();
    return await fn(root, dir);
  } finally {
    resetCompositionRootForTests();
    setSecretCodecForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

/** Probe the legacy env vars to prove they no longer open the generation gate. */
function withLlmEnv<T>(fn: () => Promise<T>): Promise<T> {
  return withEnv(
    {
      AITRACKER_LLM_BASE_URL: "https://api.example.com/v1",
      AITRACKER_LLM_API_KEY: "sk-test-123456",
      AITRACKER_LLM_MODEL: "env-test-model",
    },
    fn,
  );
}

async function latestRunStatus(
  root: Awaited<ReturnType<typeof getCompositionRoot>>,
) {
  const runs = await root.reports.listRuns();
  if (!runs.ok) throw new Error(runs.error.code);
  return runs.value[0]?.status;
}

test("daily generation uses the fixed renderer without an active profile", async () => {
  await withIsolatedRoot(async (root) => {
    const result = await generateReport("reports.daily");
    assert.equal(result.triggered, true);
    assert.match(result.reportId ?? "", /^report:/);
    assert.equal(await latestRunStatus(root), "succeeded");
    const view = await loadReports("zh-CN");
    assert.equal(view.viewModel.feed.offline, true);
    const body = await getReportBody(result.reportId!);
    assert.match(body?.body ?? "", /日报|报告/);

    const saved = await saveReportBody(
      result.reportId!,
      "# Edited daily report\n\nPortable Markdown.",
    );
    assert.equal(saved.saved, true);
    assert.equal(
      (await getReportBody(result.reportId!))?.body,
      "# Edited daily report\n\nPortable Markdown.",
    );
  });
});

test("an env-configured LLM does not replace the active-profile requirement", async () => {
  await withLlmEnv(() =>
    withIsolatedRoot(async (root) => {
      const result = await generateReport("reports.daily");
      assert.equal(result.triggered, true);
      assert.match(result.reportId ?? "", /^report:/);
      assert.equal(await latestRunStatus(root), "succeeded");
      const view = await loadReports("zh-CN");
      assert.equal(view.viewModel.feed.offline, true);
    }),
  );
});

test("an active profile does not invoke AI for an empty report", async () => {
  const previousFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    throw new Error("AI must not be called for an empty report");
  };
  try {
    await withIsolatedRoot(async (root) => {
      const profile = await root.modelProfiles.upsert({
        name: "integration-profile",
        mode: "custom",
        protocol: "openai",
        endpoint: "https://model.example.test/v1",
        model: "profile-test-model",
        apiKey: "sk-profile-123456",
      });
      assert.equal((await root.modelProfiles.setActive(profile.id)).ok, true);
      const result = await generateReport(
        "reports.weekly",
        { granularity: "week", key: "2026-08-24" },
        "en-US",
      );
      assert.equal(result.triggered, true);
      assert.ok(result.reportId);
      assert.equal(requestCount, 0);
      assert.equal(await latestRunStatus(root), "succeeded");
      const report = await getReportBody(result.reportId!);
      assert.match(report?.body ?? "", /No AI usage was recorded this week/);
      assert.doesNotMatch(report?.body ?? "", /## AI summary/);
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
