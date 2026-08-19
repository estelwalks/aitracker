import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { APP_DATA_DIR, ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
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
      TRUSTTOOLS_LLM_BASE_URL: "https://api.example.com/v1",
      TRUSTTOOLS_LLM_API_KEY: "sk-test-123456",
      TRUSTTOOLS_LLM_MODEL: "env-test-model",
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

test("without an active profile generation still runs as a deterministic offline draft", async () => {
  await withIsolatedRoot(async (root, dataRoot) => {
    const result = await generateReport("reports.daily");
    assert.equal(result.triggered, true);
    assert.match(result.reportId ?? "", /^report:/);
    assert.equal(await latestRunStatus(root), "offline");
    const view = await loadReports("zh-CN");
    assert.equal(view.viewModel.feed.offline, true);
    const reportDir = join(dataRoot, APP_DATA_DIR, "reports");
    const markdownFiles = await readdir(reportDir);
    assert.equal(markdownFiles.length, 1);
    assert.match(markdownFiles[0] ?? "", /\.md$/);
    assert.match(
      await readFile(join(reportDir, markdownFiles[0]!), "utf8"),
      /日报|报告/,
    );
    const metadata = JSON.parse(
      await readFile(
        join(dataRoot, APP_DATA_DIR, "tasks", "reports.v1.json"),
        "utf8",
      ),
    ) as { data: { documents: Array<Record<string, unknown>> } };
    assert.equal(metadata.data.documents[0]?.body, undefined);
    assert.equal(metadata.data.documents[0]?.contentFile, markdownFiles[0]);

    const saved = await saveReportBody(
      result.reportId!,
      "# Edited daily report\n\nPortable Markdown.",
    );
    assert.equal(saved.saved, true);
    assert.equal(
      (await getReportBody(result.reportId!))?.body,
      "# Edited daily report\n\nPortable Markdown.",
    );
    const revisions = await readdir(reportDir);
    assert.equal(revisions.length, 2);
    const updatedMetadata = JSON.parse(
      await readFile(
        join(dataRoot, APP_DATA_DIR, "tasks", "reports.v1.json"),
        "utf8",
      ),
    ) as { data: { documents: Array<Record<string, unknown>> } };
    assert.notEqual(
      updatedMetadata.data.documents[0]?.contentFile,
      metadata.data.documents[0]?.contentFile,
    );
  });
});

test("an env-configured LLM no longer opens the gate without an active profile", async () => {
  await withLlmEnv(() =>
    withIsolatedRoot(async (root) => {
      const result = await generateReport("reports.daily");
      assert.equal(result.triggered, true);
      assert.match(result.reportId ?? "", /^report:/);
      assert.equal(await latestRunStatus(root), "offline");
      const view = await loadReports("zh-CN");
      assert.equal(view.viewModel.feed.offline, true);
    }),
  );
});

test("an active profile triggers a real generation against the profile endpoint", async () => {
  await withIsolatedRoot(async (root) => {
    let receivedBody = "";
    const server = createServer((req: IncomingMessage, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        receivedBody = raw;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { content: "The daily brief content." } }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      const profile = await root.modelProfiles.upsert({
        name: "integration-profile",
        mode: "custom",
        protocol: "openai",
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: "profile-test-model",
        apiKey: "sk-profile-123456",
      });
      assert.ok(profile.id);

      const result = await generateReport("reports.daily");
      assert.equal(result.triggered, true);

      // The real call must have used the profile's endpoint + model, which
      // proves modelId = profile id reached the profile-backed provider.
      const payload = JSON.parse(receivedBody) as {
        model?: string;
        messages?: Array<{ content?: string }>;
      };
      assert.equal(payload.model, "profile-test-model");
      assert.match(payload.messages?.[0]?.content ?? "", /本时段共/);
      assert.equal(await latestRunStatus(root), "succeeded");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

test("an active profile with an unreachable endpoint degrades to an offline draft, never a 500", async () => {
  await withIsolatedRoot(async (root) => {
    await root.modelProfiles.upsert({
      name: "dead-profile",
      mode: "custom",
      protocol: "openai",
      endpoint: "http://127.0.0.1:1/v1",
      model: "dead-test-model",
      apiKey: "sk-dead-123456",
    });
    const result = await generateReport("reports.daily");
    assert.equal(result.triggered, true);
    assert.equal(result.errorCode, undefined);
    assert.equal(await latestRunStatus(root), "offline");
  });
});

test("a failed regeneration returns its error while the previous report remains readable", async () => {
  await withIsolatedRoot(async (root) => {
    let requestCount = 0;
    const server = createServer((req: IncomingMessage, res) => {
      req.resume();
      req.on("end", () => {
        requestCount += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify(
            requestCount === 1
              ? { choices: [{ message: { content: "Existing report." } }] }
              : { choices: [] },
          ),
        );
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      await root.modelProfiles.upsert({
        name: "failing-regeneration-profile",
        mode: "custom",
        protocol: "openai",
        endpoint: `http://127.0.0.1:${port}/v1`,
        model: "profile-test-model",
        apiKey: "sk-profile-123456",
      });

      const previous = await generateReport("reports.daily");
      assert.equal(previous.triggered, true);
      assert.ok(previous.reportId);

      const failed = await generateReport("reports.daily");
      assert.deepEqual(failed, {
        triggered: false,
        errorCode: "errors.reports.generationFailed",
      });
      assert.equal(
        (await getReportBody(previous.reportId!))?.body,
        "Existing report.",
      );
      const view = await loadReports("zh-CN");
      assert.equal(
        view.viewModel.feed.reports.some(
          (report) => report.reportId === previous.reportId,
        ),
        true,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
