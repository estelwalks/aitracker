import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";

import { APP_DATA_DIR, ENV, TEST_TMP_PREFIX } from "../../lib/app-config.ts";
import {
  getCompositionRoot,
  resetCompositionRootForTests,
} from "../../app/composition.server.ts";
import { generateReport, loadReports } from "./api.server.ts";

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
  fn: (root: Awaited<ReturnType<typeof getCompositionRoot>>) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `${TEST_TMP_PREFIX}reports-api-${randomUUID()}-`),
  );
  const previous = process.env[ENV.USAGE_HOME];
  process.env[ENV.USAGE_HOME] = dir;
  resetCompositionRootForTests();
  try {
    const root = await getCompositionRoot();
    return await fn(root);
  } finally {
    resetCompositionRootForTests();
    if (previous === undefined) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

/** Assert the whole LLM env block is absent/present during the callback. */
function withoutLlmEnv<T>(fn: () => Promise<T>): Promise<T> {
  return withEnv(
    {
      TRUSTTOOLS_LLM_BASE_URL: undefined,
      TRUSTTOOLS_LLM_API_KEY: undefined,
      TRUSTTOOLS_LLM_MODEL: undefined,
    },
    fn,
  );
}

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

async function latestRunStatus(root: Awaited<ReturnType<typeof getCompositionRoot>>) {
  const runs = await root.reports.listRuns();
  if (!runs.ok) throw new Error(runs.error.code);
  return runs.value[0]?.status;
}

test("without a profile or env LLM the transport reports triggered:false and the page is offline", async () => {
  await withoutLlmEnv(() =>
    withIsolatedRoot(async () => {
      assert.deepEqual(await generateReport("reports.daily"), {
        triggered: false,
      });
      const view = await loadReports("zh-CN");
      assert.equal(view.viewModel.feed.offline, true);
    }),
  );
});

test("an env-configured LLM keeps the legacy gate open without a profile", async () => {
  await withLlmEnv(() =>
    withIsolatedRoot(async () => {
      const result = await generateReport("reports.daily");
      assert.equal(result.triggered, true);
      const view = await loadReports("zh-CN");
      assert.equal(view.viewModel.feed.offline, false);
    }),
  );
});

test("an active profile triggers a real generation against the profile endpoint", async () => {
  await withoutLlmEnv(() =>
    withIsolatedRoot(async (root) => {
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
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
        assert.match(
          payload.messages?.[0]?.content ?? "",
          /Daily report context/,
        );
        assert.equal(await latestRunStatus(root), "succeeded");
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    }),
  );
});

test("an active profile with an unreachable endpoint degrades to an offline draft, never a 500", async () => {
  await withoutLlmEnv(() =>
    withIsolatedRoot(async (root) => {
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
    }),
  );
});
