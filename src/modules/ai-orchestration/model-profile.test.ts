/**
 * S-500 model profile store + validation + connection-test unit tests.
 *
 * Covers: validation rejections (over-long name / invalid URL / short key),
 * the full CRUD lifecycle, the guarantee that `list`/views never carry the
 * apiKey, active-profile switching and the mocked connection test.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { stat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SystemClock } from "../../platform/persistence/clock.ts";
import { NodeAtomicJsonStore } from "../../platform/persistence/infrastructure/node-atomic-json-store.ts";
import type { ModelProfile, ModelProfileInput } from "./model-profile.ts";
import {
  validateModelProfileInput,
  effectiveProtocol,
  effectiveEndpoint,
  effectiveModel,
} from "./model-profile.ts";
import {
  DEFAULT_MODEL_PROFILES_FILE,
  createModelProfileRepository,
  createProfileBackedProvider,
  modelProfilesSchema,
  type ModelProfileRepository,
} from "./model-profile.server.ts";

const VALID_KEY = "sk-0123456789abcdef";
const VALID_CUSTOM: ModelProfileInput = {
  mode: "custom",
  protocol: "openai",
  name: "DeepSeek-测试",
  apiKey: VALID_KEY,
  endpoint: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
};

function mockFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init ?? {}))) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withTempRepo<T>(
  fn: (repo: ModelProfileRepository, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `tt-model-profile-${randomUUID()}-`),
  );
  try {
    const store = new NodeAtomicJsonStore({
      filePath: join(dir, "model-profiles.v1.json"),
      defaultValue: DEFAULT_MODEL_PROFILES_FILE,
      schema: modelProfilesSchema(),
      clock: new SystemClock(),
    });
    const repo = createModelProfileRepository({ store });
    return await fn(repo, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withTempStore<T>(
  fn: (
    store: NodeAtomicJsonStore<typeof DEFAULT_MODEL_PROFILES_FILE>,
    dir: string,
  ) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(
    join(tmpdir(), `tt-model-profile-${randomUUID()}-`),
  );
  try {
    const store = new NodeAtomicJsonStore({
      filePath: join(dir, "model-profiles.v1.json"),
      defaultValue: DEFAULT_MODEL_PROFILES_FILE,
      schema: modelProfilesSchema(),
      clock: new SystemClock(),
    });
    return await fn(store, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function jsonWithoutKeys(view: unknown): string {
  return JSON.stringify(view);
}

// ── Validation (pure) ───────────────────────────────────────────────────────

test("validateModelProfileInput rejects over-long names", () => {
  const result = validateModelProfileInput({
    ...VALID_CUSTOM,
    name: "x".repeat(65),
  });
  assert.deepEqual(result, {
    ok: false,
    errorCode: "errors.modelProfile.nameTooLong",
  });
});

test("validateModelProfileInput requires a name for custom profiles", () => {
  const result = validateModelProfileInput({ ...VALID_CUSTOM, name: "  " });
  assert.deepEqual(result, {
    ok: false,
    errorCode: "errors.modelProfile.nameRequired",
  });
});

test("validateModelProfileInput rejects invalid URLs (scheme / credentials / garbage)", () => {
  for (const endpoint of [
    "ftp://api.example.com/v1",
    "https://user:pass@api.example.com/v1",
    "not-a-url",
    `https://example.com/${"a".repeat(2048)}`,
  ]) {
    const result = validateModelProfileInput({ ...VALID_CUSTOM, endpoint });
    assert.deepEqual(result, {
      ok: false,
      errorCode: "errors.modelProfile.invalidUrl",
    });
  }
});

test("validateModelProfileInput rejects short / over-long / missing keys", () => {
  const short = validateModelProfileInput({
    ...VALID_CUSTOM,
    apiKey: "sk-123",
  });
  assert.deepEqual(short, {
    ok: false,
    errorCode: "errors.modelProfile.apiKeyTooShort",
  });

  const long = validateModelProfileInput({
    ...VALID_CUSTOM,
    apiKey: `sk-${"a".repeat(512)}`,
  });
  assert.deepEqual(long, {
    ok: false,
    errorCode: "errors.modelProfile.apiKeyTooLong",
  });

  const missing = validateModelProfileInput({ ...VALID_CUSTOM, apiKey: "" });
  assert.deepEqual(missing, {
    ok: false,
    errorCode: "errors.modelProfile.apiKeyRequired",
  });

  // On update an empty key is allowed (keep stored).
  const edit = validateModelProfileInput(
    { ...VALID_CUSTOM, apiKey: "", id: "m-1" },
    true,
  );
  assert.deepEqual(edit, { ok: true });
});

test("validateModelProfileInput rejects invalid mode / protocol / model", () => {
  assert.deepEqual(
    validateModelProfileInput({ ...VALID_CUSTOM, mode: "hybrid" as never }),
    { ok: false, errorCode: "errors.modelProfile.invalidMode" },
  );
  assert.deepEqual(
    validateModelProfileInput({ ...VALID_CUSTOM, protocol: "gemini" as never }),
    { ok: false, errorCode: "errors.modelProfile.invalidProtocol" },
  );
  assert.deepEqual(
    validateModelProfileInput({ ...VALID_CUSTOM, model: "bad model!" }),
    { ok: false, errorCode: "errors.modelProfile.invalidModel" },
  );
  assert.deepEqual(validateModelProfileInput({ ...VALID_CUSTOM, model: "" }), {
    ok: false,
    errorCode: "errors.modelProfile.invalidModel",
  });
});

test("validateModelProfileInput accepts valid custom and official payloads", () => {
  assert.deepEqual(validateModelProfileInput(VALID_CUSTOM), { ok: true });
  assert.deepEqual(
    validateModelProfileInput({
      mode: "official",
      name: "官方",
      apiKey: VALID_KEY,
    }),
    { ok: true },
  );
  // Official mode does not require name / protocol / endpoint / model.
  assert.deepEqual(
    validateModelProfileInput({ mode: "official", apiKey: VALID_KEY }),
    { ok: true },
  );
});

test("effective helpers: official fixes protocol/endpoint/model", () => {
  assert.equal(effectiveProtocol("official", "anthropic"), "openai");
  assert.equal(effectiveProtocol("custom", "anthropic"), "anthropic");
  assert.equal(
    effectiveEndpoint({ mode: "official" }),
    "https://api.deepseek.com/v1",
  );
  assert.equal(
    effectiveEndpoint({ mode: "custom", protocol: "openai" }),
    "https://api.openai.com/v1",
  );
  assert.equal(effectiveModel({ mode: "official" }), "deepseek-chat");
  assert.equal(effectiveModel({ mode: "custom", model: " gpt-4o " }), "gpt-4o");
});

// ── CRUD lifecycle ──────────────────────────────────────────────────────────

test("repository: upsert creates a key-free view and activates it", async () => {
  await withTempRepo(async (repo) => {
    const view = await repo.upsert(VALID_CUSTOM);
    assert.match(view.id, /^m-/);
    assert.equal(view.name, "DeepSeek-测试");
    assert.equal(view.apiKeyMasked, true);
    assert.equal("apiKey" in view, false, "view must never expose the key");
    assert.equal(jsonWithoutKeys(view).includes(VALID_KEY), false);

    const list = await repo.listViews();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, view.id);
    assert.equal(await repo.getActiveView().then((a) => a?.id), view.id);
  });
});

test("repository: upsert update keeps createdAt and stored key when key is blank", async () => {
  await withTempRepo(async (repo) => {
    const created = await repo.upsert(VALID_CUSTOM);
    const updated = await repo.upsert({
      ...VALID_CUSTOM,
      id: created.id,
      name: "Renamed",
      apiKey: "",
      model: "deepseek-reasoner",
    });
    assert.equal(updated.id, created.id);
    assert.equal(updated.name, "Renamed");
    assert.equal(updated.model, "deepseek-reasoner");
    assert.equal(updated.createdAt, created.createdAt);
    // The stored key survives a blank-key edit.
    const full = await repo.getProfileForExecution(created.id);
    assert.equal(full?.apiKey, VALID_KEY);
    // A supplied key replaces it.
    await repo.upsert({
      ...VALID_CUSTOM,
      id: created.id,
      apiKey: "sk-new-key-123456",
    });
    const replaced = await repo.getProfileForExecution(created.id);
    assert.equal(replaced?.apiKey, "sk-new-key-123456");
  });
});

test("repository: listViews never contains the apiKey anywhere", async () => {
  await withTempRepo(async (repo) => {
    await repo.upsert(VALID_CUSTOM);
    await repo.upsert({
      mode: "custom",
      protocol: "anthropic",
      name: "Claude",
      apiKey: "sk-ant-0987654321",
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4",
    });
    const list = await repo.listViews();
    assert.equal(list.length, 2);
    for (const view of list) {
      assert.equal("apiKey" in view, false);
      assert.equal(JSON.stringify(view).includes("sk-"), false);
    }
  });
});

test("repository: remove deletes, and deleting the active profile activates the first survivor", async () => {
  await withTempRepo(async (repo) => {
    const first = await repo.upsert({ ...VALID_CUSTOM, name: "A" });
    const second = await repo.upsert({ ...VALID_CUSTOM, name: "B" });
    assert.equal(await repo.getActiveView().then((a) => a?.id), second.id);

    const removed = await repo.remove(first.id);
    assert.deepEqual(removed, { ok: true });
    assert.equal((await repo.listViews()).length, 1);
    assert.equal(await repo.getActiveView().then((a) => a?.id), second.id);

    const removedActive = await repo.remove(second.id);
    assert.deepEqual(removedActive, { ok: true });
    assert.equal(await repo.getActiveView(), null);

    const missing = await repo.remove("m-does-not-exist");
    assert.deepEqual(missing, {
      ok: false,
      errorCode: "errors.modelProfile.notFound",
    });
  });
});

test("repository: setActive switches and rejects unknown ids", async () => {
  await withTempRepo(async (repo) => {
    const first = await repo.upsert({ ...VALID_CUSTOM, name: "A" });
    const second = await repo.upsert({ ...VALID_CUSTOM, name: "B" });
    const switched = await repo.setActive(first.id);
    assert.deepEqual(switched, { ok: true });
    assert.equal(await repo.getActiveView().then((a) => a?.id), first.id);

    const missing = await repo.setActive("m-does-not-exist");
    assert.deepEqual(missing, {
      ok: false,
      errorCode: "errors.modelProfile.notFound",
    });
    assert.equal(await repo.getActiveView().then((a) => a?.id), first.id);
  });
});

test("repository: official mode stores the fixed preset endpoint/model", async () => {
  await withTempRepo(async (repo) => {
    const view = await repo.upsert({
      mode: "official",
      name: "官方默认",
      apiKey: VALID_KEY,
    });
    assert.equal(view.protocol, "openai");
    assert.equal(view.endpoint, "https://api.deepseek.com/v1");
    assert.equal(view.model, "deepseek-chat");
    const full = await repo.getProfileForExecution(view.id);
    assert.equal(full?.apiKey, VALID_KEY);
  });
});

test("repository: persisted file is written with 0600 permissions", async () => {
  await withTempRepo(async (repo, dir) => {
    await repo.upsert(VALID_CUSTOM);
    const filePath = join(dir, "model-profiles.v1.json");
    const info = await stat(filePath);
    // POSIX permission bits are meaningless on Windows (Node reports 0o666
    // there); the 0600 contract applies to POSIX platforms only.
    if (process.platform === "win32") {
      assert.ok((info.mode & 0o777) !== 0);
      return;
    }
    assert.equal(info.mode & 0o777, 0o600);
  });
});

// ── Connection test (mocked) ────────────────────────────────────────────────

test("testModelProfile: ok on 2xx, failed on non-2xx, timeout on abort", async () => {
  const calls: string[] = [];
  await withTempStore(async (store) => {
    const okRepo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async (url, init) => {
        calls.push(`${init.method} ${url}`);
        return jsonResponse({ choices: [{ message: { content: "pong" } }] });
      }),
    });
    const ok = await okRepo.test(VALID_CUSTOM);
    assert.equal(ok.ok, true);
    assert.ok(typeof ok.latencyMs === "number");
    assert.equal(calls.length, 1);
    assert.match(calls[0]!, /chat\/completions$/);
  });

  await withTempStore(async (store) => {
    const failRepo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async () => jsonResponse({ error: "nope" }, 500)),
    });
    const failed = await failRepo.test(VALID_CUSTOM);
    assert.deepEqual(failed, {
      ok: false,
      errorCode: "errors.modelProfile.testFailed",
    });
  });

  await withTempStore(async (store) => {
    const timeoutRepo = createModelProfileRepository({
      store,
      testTimeoutMs: 30,
      fetchFn: ((_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        })) as typeof fetch,
    });
    const timedOut = await timeoutRepo.test(VALID_CUSTOM);
    assert.deepEqual(timedOut, {
      ok: false,
      errorCode: "errors.modelProfile.testTimeout",
    });
  });
});

test("testModelProfile: editing with a blank key reuses the stored secret", async () => {
  const seenHeaders: Array<Record<string, string>> = [];
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async (_url, init) => {
        seenHeaders.push((init.headers as Record<string, string>) ?? {});
        return jsonResponse({ choices: [{ message: { content: "pong" } }] });
      }),
    });
    const created = await repo.upsert(VALID_CUSTOM);
    const result = await repo.test({
      mode: "custom",
      protocol: "openai",
      name: "DeepSeek-测试",
      id: created.id,
      apiKey: "",
      model: "deepseek-chat",
    });
    assert.equal(result.ok, true);
    assert.equal(seenHeaders[0]?.authorization, `Bearer ${VALID_KEY}`);
  });
});

// ── Remote model list (mocked) ──────────────────────────────────────────────

test("listModels: remote list succeeds and is sorted", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async (url, init) => {
        seenUrl = url;
        seenHeaders = (init.headers as Record<string, string>) ?? {};
        return jsonResponse({
          data: [{ id: "deepseek-reasoner" }, { id: "deepseek-chat" }],
        });
      }),
    });
    const result = await repo.listModels({
      mode: "custom",
      protocol: "openai",
      apiKey: VALID_KEY,
      endpoint: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "remote");
    assert.deepEqual(result.models, ["deepseek-chat", "deepseek-reasoner"]);
    assert.match(seenUrl, /\/models$/);
    assert.equal(seenHeaders.authorization, `Bearer ${VALID_KEY}`);
  });
});

test("listModels: anthropic protocol uses x-api-key and anthropic-version", async () => {
  let seenHeaders: Record<string, string> = {};
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async (_url, init) => {
        seenHeaders = (init.headers as Record<string, string>) ?? {};
        return jsonResponse({ data: [{ id: "claude-sonnet-4" }] });
      }),
    });
    const result = await repo.listModels({
      mode: "custom",
      protocol: "anthropic",
      apiKey: "sk-ant-0987654321",
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "remote");
    assert.equal(seenHeaders["x-api-key"], "sk-ant-0987654321");
    assert.equal(seenHeaders["anthropic-version"], "2023-06-01");
  });
});

test("listModels: HTTP 403 falls back to the provider default list", async () => {
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async () => jsonResponse({ error: "forbidden" }, 403)),
    });
    const result = await repo.listModels({
      mode: "custom",
      protocol: "openai",
      apiKey: VALID_KEY,
      endpoint: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "fallback");
    assert.ok(result.models?.includes("deepseek-chat"));
    assert.ok(result.models?.includes("deepseek-reasoner"));
  });
});

test("listModels: unknown host falls back to the protocol default list", async () => {
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async () => jsonResponse({ error: "nope" }, 500)),
    });
    const result = await repo.listModels({
      mode: "custom",
      protocol: "openai",
      apiKey: VALID_KEY,
      endpoint: "https://example.com/v1",
      model: "gpt-4o",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "fallback");
    assert.ok(result.models?.includes("gpt-4o"));
    assert.ok(result.models?.includes("o4-mini"));
  });
});

test("listModels: editing with a blank key reuses the stored secret", async () => {
  let seenAuth = "";
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async (_url, init) => {
        seenAuth =
          (init.headers as Record<string, string>)?.authorization ?? "";
        return jsonResponse({ data: [{ id: "deepseek-chat" }] });
      }),
    });
    const created = await repo.upsert(VALID_CUSTOM);
    const result = await repo.listModels({
      id: created.id,
      mode: "custom",
      protocol: "openai",
      apiKey: "",
      endpoint: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
    });
    assert.equal(result.ok, true);
    assert.equal(result.source, "remote");
    assert.equal(seenAuth, `Bearer ${VALID_KEY}`);
  });
});

test("listModels: no key returns listFailed without calling fetch", async () => {
  let calls = 0;
  await withTempStore(async (store) => {
    const repo = createModelProfileRepository({
      store,
      fetchFn: mockFetch(async () => {
        calls += 1;
        return jsonResponse({ data: [] });
      }),
    });
    const result = await repo.listModels({
      mode: "custom",
      protocol: "openai",
      apiKey: "",
      name: "x",
      model: "y",
    });
    assert.deepEqual(result, {
      ok: false,
      errorCode: "errors.modelProfile.listFailed",
    });
  });
  assert.equal(calls, 0);
});

// ── Profile-backed provider (mocked) ────────────────────────────────────────

test("createProfileBackedProvider: resolves profile and parses OpenAI response", async () => {
  const profile: ModelProfile = {
    id: "m-1",
    name: "DeepSeek",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const provider = createProfileBackedProvider({
    resolve: async (id) => (id === profile.id ? profile : undefined),
    fetchFn: mockFetch(async (url) => {
      assert.match(url, /\/chat\/completions$/);
      return jsonResponse({ choices: [{ message: { content: "note" } }] });
    }),
  });
  const response = await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });
  assert.equal(response.text, "note");
  assert.equal(response.providerId, "profile");
  assert.equal(response.modelId, profile.id);
});

test("createProfileBackedProvider: anthropic headers and content parsing", async () => {
  const profile: ModelProfile = {
    id: "m-2",
    name: "Claude",
    mode: "custom",
    protocol: "anthropic",
    apiKey: "sk-ant-0987654321",
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let seenUrl = "";
  let seenKey = "";
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenKey = (init.headers as Record<string, string>)["x-api-key"] ?? "";
      return jsonResponse({ content: [{ type: "text", text: "claude note" }] });
    }),
  });
  const response = await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });
  assert.match(seenUrl, /\/messages$/);
  assert.equal(seenKey, "sk-ant-0987654321");
  assert.equal(response.text, "claude note");
});

test("createProfileBackedProvider: unknown profile throws (executor falls back)", async () => {
  const provider = createProfileBackedProvider({
    resolve: async () => undefined,
  });
  await assert.rejects(
    provider.invoke({
      modelId: "m-missing",
      prompt: { id: "p", version: 1, template: "T" },
      input: { text: "meta" },
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "errors.modelProfile.notFound",
  );
});
