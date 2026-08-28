/**
 * S-500 model profile validation + SQLite repository + provider unit tests.
 *
 * Covers: validation rejections (over-long name / invalid URL / short key),
 * the SQLite CRUD lifecycle (key-free views, active switching, secret
 * clearing), `chatUrl`/`modelListUrl` URL construction and the profile-backed
 * provider adapter.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseHost } from "../../platform/database/database-host.server.ts";
import { runMigrations } from "../../platform/database/migration-runner.server.ts";
import type { ModelProfile, ModelProfileInput } from "./model-profile.ts";
import {
  effectiveEndpoint,
  effectiveModel,
  effectiveProtocol,
  RECOMMENDED_MODEL_OPTIONS,
  validateModelProfileInput,
} from "./model-profile.ts";
import {
  chatUrl,
  createProfileBackedProvider,
  createModelProfileNetworkOperations,
  diagnoseModelProfile,
  getActiveModelProfileForExecution,
  modelRequestUrl,
  modelListUrl,
  type ModelProfileRepository,
} from "./model-profile.server.ts";
import {
  createSqliteModelProfileRepository,
  type ModelSecretCodec,
} from "./infrastructure/sqlite-model-profile-repository.server.ts";

const VALID_KEY = "sk-0123456789abcdef";
const VALID_CUSTOM: ModelProfileInput = {
  mode: "custom",
  protocol: "openai",
  name: "DeepSeek-测试",
  apiKey: VALID_KEY,
  endpoint: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
};

test("active model resolution never falls back to a configured but disabled profile", async () => {
  let executionLookupCount = 0;
  const profile = {
    id: "configured-not-active",
  } as ModelProfile;
  const resolved = await getActiveModelProfileForExecution({
    async getActiveView() {
      return null;
    },
    async getProfileForExecution() {
      executionLookupCount += 1;
      return profile;
    },
  });

  assert.equal(resolved, undefined);
  assert.equal(executionLookupCount, 0);
});

test("active model resolution uses the explicitly enabled profile", async () => {
  const profile = {
    id: "enabled-profile",
  } as ModelProfile;
  const resolved = await getActiveModelProfileForExecution({
    async getActiveView() {
      return {
        id: profile.id,
      } as Awaited<ReturnType<ModelProfileRepository["getActiveView"]>>;
    },
    async getProfileForExecution(id) {
      assert.equal(id, profile.id);
      return profile;
    },
  });

  assert.equal(resolved, profile);
});

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

const codec: ModelSecretCodec = {
  async encrypt(plaintext) {
    const payload = new TextEncoder().encode(plaintext);
    const ciphertext = new Uint8Array(Math.max(16, payload.length));
    ciphertext.fill(0xa5);
    for (let index = 0; index < payload.length; index += 1) {
      ciphertext[index] = payload[index]! ^ 0xa5;
    }
    return { ciphertext, encryptionKind: "safe-storage" };
  },
  async decrypt(secret) {
    const bytes = new Uint8Array(secret.ciphertext.length);
    for (let index = 0; index < secret.ciphertext.length; index += 1) {
      bytes[index] = secret.ciphertext[index]! ^ 0xa5;
    }
    return new TextDecoder().decode(bytes).replace(/\0+$/u, "");
  },
};

function withRepo(
  t: { after(fn: () => void): void },
  fn: (repository: ModelProfileRepository, host: DatabaseHost) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "aitracker-model-profile-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = createSqliteModelProfileRepository({
    database: host,
    secretCodec: codec,
    now: () => 100,
  });
  return fn(repository, host);
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
      ...VALID_CUSTOM,
      protocol: "openai-responses",
      model: "gpt-5.2",
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateModelProfileInput({
      mode: "official",
      name: "官方",
      apiKey: VALID_KEY,
      model: "deepseek-v4-flash",
    }),
    { ok: true },
  );
  // Official mode accepts models returned by the provider, without a built-in allowlist.
  assert.deepEqual(
    validateModelProfileInput({
      mode: "official",
      apiKey: VALID_KEY,
      model: "provider-model-2026",
    }),
    { ok: true },
  );
  assert.deepEqual(validateModelProfileInput({ mode: "official" }), {
    ok: false,
    errorCode: "errors.modelProfile.invalidModel",
  });
});

test("effective helpers: official fixes protocol/endpoint/model", () => {
  assert.equal(effectiveProtocol("official", "anthropic"), "openai-responses");
  assert.equal(effectiveProtocol("custom", "anthropic"), "anthropic");
  assert.equal(
    effectiveEndpoint({ mode: "official" }),
    "https://api.deepseek.com",
  );
  assert.equal(
    effectiveEndpoint({ mode: "custom", protocol: "openai" }),
    "https://api.openai.com/v1",
  );
  assert.equal(effectiveModel({ mode: "official" }), "deepseek-chat");
  assert.equal(
    effectiveModel({
      mode: "official",
      model: RECOMMENDED_MODEL_OPTIONS[1].id,
    }),
    "deepseek-v4-pro",
  );
  assert.equal(effectiveModel({ mode: "custom", model: " gpt-4o " }), "gpt-4o");
});

// ── URL construction (pure) ─────────────────────────────────────────────────

test("chatUrl/modelListUrl build protocol-specific endpoints", () => {
  assert.equal(
    chatUrl("openai", "https://api.openai.com/v1"),
    "https://api.openai.com/v1/chat/completions",
  );
  assert.equal(
    chatUrl("anthropic", "https://api.anthropic.com/v1"),
    "https://api.anthropic.com/v1/messages",
  );
  assert.equal(
    chatUrl("openai", "https://api.openai.com/v1/"),
    "https://api.openai.com/v1/chat/completions",
  );
  assert.equal(
    chatUrl("openai-responses", "https://api.openai.com/v1/"),
    "https://api.openai.com/v1/responses",
  );
  assert.equal(
    modelListUrl("https://api.deepseek.com/v1"),
    "https://api.deepseek.com/v1/models",
  );
  assert.equal(
    modelListUrl("https://api.deepseek.com/v1/"),
    "https://api.deepseek.com/v1/models",
  );
  assert.equal(
    modelRequestUrl("official", "openai", "https://api.deepseek.com/"),
    "https://api.deepseek.com/responses",
  );
});

test("recommended model network test uses the OpenAI Responses request format", async () => {
  let seenUrl = "";
  let seenBody: unknown;
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      return jsonResponse({ output_text: "OK" });
    }),
  });

  const result = await network.test({
    mode: "official",
    apiKey: VALID_KEY,
    model: "provider-model-2026",
  });
  assert.equal(result.ok, true);
  assert.equal(seenUrl, "https://api.deepseek.com/responses");
  assert.deepEqual(seenBody, {
    model: "provider-model-2026",
    max_output_tokens: 16,
    input: "Reply with OK.",
  });
});

test("custom Responses profile test uses Responses body and Bearer auth", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ output_text: "OK" });
    }),
  });

  const result = await network.test({
    ...VALID_CUSTOM,
    protocol: "openai-responses",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.2",
  });
  assert.equal(result.ok, true);
  assert.equal(seenUrl, "https://api.openai.com/v1/responses");
  assert.equal(
    (seenInit?.headers as Record<string, string>).authorization,
    `Bearer ${VALID_KEY}`,
  );
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    model: "gpt-5.2",
    max_output_tokens: 16,
    input: "Reply with OK.",
  });
});

test("model profile network test builds OpenAI request and returns latency", async () => {
  let seenUrl = "";
  let seenInit: RequestInit | undefined;
  const network = createModelProfileNetworkOperations({
    timeoutMs: 100,
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({ choices: [{ message: { content: "OK" } }] });
    }),
  });

  const result = await network.test(VALID_CUSTOM);
  assert.equal(result.ok, true);
  assert.equal(typeof result.latencyMs, "number");
  assert.equal(seenUrl, "https://api.deepseek.com/v1/chat/completions");
  assert.equal(
    (seenInit?.headers as Record<string, string>).authorization,
    `Bearer ${VALID_KEY}`,
  );
  assert.deepEqual(JSON.parse(String(seenInit?.body)), {
    model: "deepseek-chat",
    max_tokens: 16,
    messages: [{ role: "user", content: "Reply with OK." }],
  });
});

test("model profile network test builds Anthropic x-api-key request", async () => {
  let seenUrl = "";
  let seenHeaders: Record<string, string> = {};
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenHeaders = init.headers as Record<string, string>;
      return jsonResponse({ content: [{ type: "text", text: "OK" }] });
    }),
  });

  const result = await network.test({
    mode: "custom",
    protocol: "anthropic",
    name: "Claude",
    apiKey: "sk-ant-0987654321",
    endpoint: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4",
  });
  assert.equal(result.ok, true);
  assert.equal(seenUrl, "https://api.anthropic.com/v1/messages");
  assert.equal(seenHeaders["x-api-key"], "sk-ant-0987654321");
  assert.equal(seenHeaders["anthropic-version"], "2023-06-01");
});

test("model profile network test accepts successful provider responses without a chat envelope", async () => {
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async () => new Response(null, { status: 204 })),
  });

  const result = await network.test(VALID_CUSTOM);
  assert.equal(result.ok, true);
  assert.equal(typeof result.latencyMs, "number");
});

test("model profile list returns remote ids without exposing the key", async () => {
  let seenUrl = "";
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      assert.equal(
        (init.headers as Record<string, string>).authorization,
        `Bearer ${VALID_KEY}`,
      );
      return jsonResponse({
        data: [{ id: "gpt-4o" }, { id: "gpt-4o" }, { id: "bad model" }],
      });
    }),
  });
  const result = await network.listModels(VALID_CUSTOM);
  assert.deepEqual(result, {
    ok: true,
    models: ["gpt-4o"],
    source: "remote",
    message: "Fetched 1 models from the remote endpoint.",
  });
  assert.equal(seenUrl, "https://api.deepseek.com/v1/models");
  assert.equal(JSON.stringify(result).includes(VALID_KEY), false);
});

test("recommended profile fetches the official model list without defaults", async () => {
  let seenUrl = "";
  const network = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async (url) => {
      seenUrl = url;
      return jsonResponse({ data: [{ id: "provider-model-2026" }] });
    }),
  });

  const result = await network.listModels({
    mode: "official",
    apiKey: VALID_KEY,
  });
  assert.deepEqual(result.models, ["provider-model-2026"]);
  assert.equal(result.source, "remote");
  assert.equal(seenUrl, "https://api.deepseek.com/models");
});

test("model profile list accepts common provider envelopes and model field names", async () => {
  const payloads = [
    [{ name: "llama-3.3" }, { model: "qwen-plus" }],
    { models: [{ id: "gpt-4o" }] },
    { result: [{ id: "claude-sonnet-4-5" }] },
  ] as const;

  for (const payload of payloads) {
    const network = createModelProfileNetworkOperations({
      fetchFn: mockFetch(async () => jsonResponse(payload)),
    });
    const result = await network.listModels(VALID_CUSTOM);
    assert.equal(result.ok, true);
    assert.equal(result.source, "remote");
  }
});

test("model profile list reports HTTP failure without default models", async () => {
  const httpFailure = createModelProfileNetworkOperations({
    fetchFn: mockFetch(async () => new Response("no", { status: 503 })),
  });
  const failed = await httpFailure.listModels(VALID_CUSTOM);
  assert.equal(failed.ok, false);
  assert.equal(failed.source, "fallback");
  assert.equal(failed.models, undefined);
  assert.match(failed.message ?? "", /HTTP 503/);

  const timeout = createModelProfileNetworkOperations({
    timeoutMs: 5,
    fetchFn: ((_, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          {
            once: true,
          },
        );
      })) as typeof fetch,
  });
  const timedOut = await timeout.test(VALID_CUSTOM);
  assert.equal(timedOut.errorCode, "errors.modelProfile.testTimeout");
  assert.equal(typeof timedOut.latencyMs, "number");
});

// ── SQLite repository lifecycle ─────────────────────────────────────────────

test("sqlite repository: upsert creates a key-free view without activating it", async (t) => {
  await withRepo(t, async (repository) => {
    const view = await repository.upsert(VALID_CUSTOM);
    assert.match(view.id, /^m-/);
    assert.equal(view.name, "DeepSeek-测试");
    assert.equal(view.apiKeyMasked, true);
    assert.equal("apiKey" in view, false, "view must never expose the key");
    assert.equal(JSON.stringify(view).includes(VALID_KEY), false);

    const list = await repository.listViews();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, view.id);
    assert.equal(await repository.getActiveView(), null);
  });
});

test("sqlite repository: update keeps createdAt and stored key when key is blank", async (t) => {
  await withRepo(t, async (repository) => {
    const created = await repository.upsert(VALID_CUSTOM);
    await repository.setActive(created.id);
    const updated = await repository.upsert({
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
    assert.equal(
      await repository.getActiveView().then((active) => active?.id),
      created.id,
    );
    // The stored key survives a blank-key edit (decrypted via the codec).
    const full = await repository.getProfileForExecution(created.id);
    assert.equal(full?.apiKey, VALID_KEY);
    // A supplied key replaces it.
    await repository.upsert({
      ...VALID_CUSTOM,
      id: created.id,
      apiKey: "sk-new-key-123456",
    });
    const replaced = await repository.getProfileForExecution(created.id);
    assert.equal(replaced?.apiKey, "sk-new-key-123456");
  });
});

test("sqlite repository: auth round-trips and blank-key test uses the stored key", async (t) => {
  let received: ModelProfileInput | undefined;
  const directory = mkdtempSync(
    join(tmpdir(), "aitracker-model-profile-auth-"),
  );
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = createSqliteModelProfileRepository({
    database: host,
    secretCodec: codec,
    testProfile: async (input) => {
      received = input;
      return { ok: true, latencyMs: 1 };
    },
  });

  const saved = await repository.upsert({ ...VALID_CUSTOM, auth: "x-api-key" });
  assert.equal(saved.auth, "x-api-key");
  assert.equal(
    (await repository.getProfileForExecution(saved.id))?.auth,
    "x-api-key",
  );
  const result = await repository.test({
    ...VALID_CUSTOM,
    id: saved.id,
    apiKey: "",
    auth: undefined,
  });
  assert.deepEqual(result, { ok: true, latencyMs: 1 });
  assert.equal(received?.apiKey, VALID_KEY);
  assert.equal(received?.auth, "x-api-key");
});

test("sqlite repository: custom Responses format persists directly in protocol", async (t) => {
  await withRepo(t, async (repository, host) => {
    const saved = await repository.upsert({
      ...VALID_CUSTOM,
      protocol: "openai-responses",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-5.2",
    });
    assert.equal(saved.protocol, "openai-responses");
    assert.equal(saved.auth, "bearer");
    const row = host
      .prepare("SELECT protocol FROM model_profiles WHERE profile_id = ?")
      .get(saved.id);
    assert.equal(row?.protocol, "openai-responses");
  });
});

test("sqlite repository: listViews never contains the apiKey anywhere", async (t) => {
  await withRepo(t, async (repository) => {
    await repository.upsert(VALID_CUSTOM);
    await repository.upsert({
      mode: "custom",
      protocol: "anthropic",
      name: "Claude",
      apiKey: "sk-ant-0987654321",
      endpoint: "https://api.anthropic.com/v1",
      model: "claude-sonnet-4",
    });
    const list = await repository.listViews();
    assert.equal(list.length, 2);
    for (const view of list) {
      assert.equal("apiKey" in view, false);
      assert.equal(JSON.stringify(view).includes("sk-"), false);
    }
  });
});

test("sqlite repository: remove deletes, clears the secret and activates the survivor", async (t) => {
  await withRepo(t, async (repository, host) => {
    const first = await repository.upsert({ ...VALID_CUSTOM, name: "A" });
    const second = await repository.upsert({ ...VALID_CUSTOM, name: "B" });
    await repository.setActive(second.id);
    assert.equal(
      await repository.getActiveView().then((a) => a?.id),
      second.id,
    );
    assert.equal(
      host.prepare("SELECT COUNT(*) AS n FROM secure_secrets").get()?.n,
      2n,
    );

    const removed = await repository.remove(first.id);
    assert.deepEqual(removed, { ok: true });
    assert.equal((await repository.listViews()).length, 1);
    assert.equal(
      await repository.getActiveView().then((a) => a?.id),
      second.id,
    );

    // The removed profile's secret is cleared; the survivor's remains.
    assert.equal(
      host.prepare("SELECT COUNT(*) AS n FROM secure_secrets").get()?.n,
      1n,
    );
    assert.equal(
      host
        .prepare("SELECT COUNT(*) AS n FROM secure_secrets WHERE secret_id = ?")
        .get(`${first.id}:api-key`)?.n,
      0n,
    );

    const removedActive = await repository.remove(second.id);
    assert.deepEqual(removedActive, { ok: true });
    assert.equal(await repository.getActiveView(), null);

    const missing = await repository.remove("m-does-not-exist");
    assert.deepEqual(missing, {
      ok: false,
      errorCode: "errors.modelProfile.notFound",
    });
  });
});

test("sqlite repository: maintains a single active profile", async (t) => {
  await withRepo(t, async (repository, host) => {
    await repository.upsert({ ...VALID_CUSTOM, name: "A" });
    const second = await repository.upsert({ ...VALID_CUSTOM, name: "B" });
    assert.equal(
      host
        .prepare("SELECT COUNT(*) AS n FROM model_profiles WHERE is_active = 1")
        .get()?.n,
      0n,
    );
    await repository.setActive(second.id);
    assert.equal(
      host
        .prepare("SELECT COUNT(*) AS n FROM model_profiles WHERE is_active = 1")
        .get()?.n,
      1n,
    );
    assert.equal(await repository.getActiveView().then((a) => a?.name), "B");
  });
});

test("sqlite repository: setActive switches and rejects unknown ids", async (t) => {
  await withRepo(t, async (repository) => {
    const first = await repository.upsert({ ...VALID_CUSTOM, name: "A" });
    const second = await repository.upsert({ ...VALID_CUSTOM, name: "B" });
    const switched = await repository.setActive(first.id);
    assert.deepEqual(switched, { ok: true });
    assert.equal(await repository.getActiveView().then((a) => a?.id), first.id);

    const missing = await repository.setActive("m-does-not-exist");
    assert.deepEqual(missing, {
      ok: false,
      errorCode: "errors.modelProfile.notFound",
    });
    assert.equal(await repository.getActiveView().then((a) => a?.id), first.id);
    assert.equal(
      (await repository.listViews()).find((v) => v.id === second.id) !==
        undefined,
      true,
    );
  });
});

test("sqlite repository: official mode stores the fixed preset and encrypted key", async (t) => {
  await withRepo(t, async (repository, host) => {
    const view = await repository.upsert({
      mode: "official",
      name: "官方默认",
      apiKey: VALID_KEY,
      model: "provider-model-2026",
    });
    assert.equal(view.protocol, "openai-responses");
    const stored = host
      .prepare("SELECT protocol FROM model_profiles WHERE profile_id = ?")
      .get(view.id);
    assert.equal(stored?.protocol, "openai-responses");
    assert.equal(view.endpoint, "https://api.deepseek.com");
    assert.equal(view.model, "provider-model-2026");
    const full = await repository.getProfileForExecution(view.id);
    assert.equal(full?.apiKey, VALID_KEY);
  });
});

test("sqlite repository: recommended pro model is persisted and exposed", async (t) => {
  await withRepo(t, async (repository) => {
    const view = await repository.upsert({
      mode: "official",
      name: "推荐 Pro",
      model: "deepseek-v4-pro",
      apiKey: VALID_KEY,
    });
    assert.equal(view.model, "deepseek-v4-pro");
    const profile = await repository.getProfileForExecution(view.id);
    assert.equal(profile?.model, "deepseek-v4-pro");
    assert.equal(effectiveModel(profile!), "deepseek-v4-pro");
  });
});

test("sqlite repository: keyless official profiles cannot be created or activated", async (t) => {
  await withRepo(t, async (repository) => {
    await assert.rejects(
      () =>
        repository.upsert({
          mode: "official",
          model: "provider-model-2026",
        }),
      (error: unknown) =>
        error instanceof Error &&
        (error as { code?: unknown }).code ===
          "errors.modelProfile.apiKeyRequired",
    );
  });
});

test("createProfileBackedProvider: recommended profile uses OpenAI Responses", async () => {
  const profile: ModelProfile = {
    id: "m-official",
    name: "Recommended",
    mode: "official",
    protocol: "openai-responses",
    apiKey: VALID_KEY,
    endpoint: "https://api.deepseek.com",
    model: "provider-model-2026",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let seenUrl = "";
  let seenBody: unknown;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async (url, init) => {
      seenUrl = url;
      seenBody = JSON.parse(String(init.body));
      return jsonResponse({
        output: [{ content: [{ type: "output_text", text: "note" }] }],
      });
    }),
  });

  const response = await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    maxOutputTokens: 128,
    signal: new AbortController().signal,
  });

  assert.equal(seenUrl, "https://api.deepseek.com/responses");
  assert.deepEqual(seenBody, {
    model: "provider-model-2026",
    max_output_tokens: 128,
    input: "T\n\nmeta",
  });
  assert.equal(response.text, "note");
});

test("createProfileBackedProvider: custom Responses profile parses output_text", async () => {
  const profile: ModelProfile = {
    id: "m-custom-responses",
    name: "OpenAI Responses",
    mode: "custom",
    protocol: "openai-responses",
    apiKey: VALID_KEY,
    endpoint: "https://api.openai.com/v1",
    model: "gpt-5.2",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let seenUrl = "";
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async (url) => {
      seenUrl = url;
      return jsonResponse({ output_text: "response text" });
    }),
  });

  const response = await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });

  assert.equal(seenUrl, "https://api.openai.com/v1/responses");
  assert.equal(response.text, "response text");
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

test("createProfileBackedProvider: retries transient gateway failures", async () => {
  const profile: ModelProfile = {
    id: "m-retry",
    name: "Retry profile",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.example.test/v1",
    model: "retry-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let calls = 0;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async () => {
      calls += 1;
      return calls === 1
        ? new Response("busy", { status: 503 })
        : jsonResponse({ choices: [{ message: { content: "note" } }] });
    }),
  });

  const response = await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });

  assert.equal(calls, 2);
  assert.equal(response.text, "note");
});

test("createProfileBackedProvider: accepts common OpenAI-compatible text envelopes", async () => {
  const profile: ModelProfile = {
    id: "m-envelope",
    name: "Envelope profile",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.example.test/v1",
    model: "envelope-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const responses = [
    { choices: [{ message: { content: [{ type: "text", text: "one" }] } }] },
    { choices: [{ text: "two" }] },
    { output_text: "three" },
  ];
  let index = 0;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async () =>
      jsonResponse(responses[index++ % responses.length]),
    ),
  });

  for (const expected of ["one", "two", "three"]) {
    const response = await provider.invoke({
      modelId: profile.id,
      prompt: { id: "p", version: 1, template: "T" },
      input: { text: "meta" },
      signal: new AbortController().signal,
    });
    assert.equal(response.text, expected);
  }
});

test("createProfileBackedProvider: does not retry permanent client failures", async () => {
  const profile: ModelProfile = {
    id: "m-client-error",
    name: "Client error profile",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.example.test/v1",
    model: "client-error-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let calls = 0;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async () => {
      calls += 1;
      return new Response("bad request", { status: 400 });
    }),
  });

  await assert.rejects(
    provider.invoke({
      modelId: profile.id,
      prompt: { id: "p", version: 1, template: "T" },
      input: { text: "meta" },
      signal: new AbortController().signal,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === "ai.provider-http-client",
  );
  assert.equal(calls, 1);
});

test("createProfileBackedProvider: uses the requested max output tokens", async () => {
  const profile: ModelProfile = {
    id: "m-token-limit",
    name: "Bounded model",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.example.test/v1",
    model: "bounded-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let requestBody: unknown;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return jsonResponse({ choices: [{ message: { content: "note" } }] });
    }),
  });

  await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    maxOutputTokens: 8192,
    signal: new AbortController().signal,
  });

  assert.equal((requestBody as { max_tokens?: unknown }).max_tokens, 8192);
});

test("createProfileBackedProvider: preserves the legacy max token default", async () => {
  const profile: ModelProfile = {
    id: "m-default-limit",
    name: "Default model",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://api.example.test/v1",
    model: "default-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  let requestBody: unknown;
  const provider = createProfileBackedProvider({
    resolve: async () => profile,
    fetchFn: mockFetch(async (_url, init) => {
      requestBody = JSON.parse(String(init.body));
      return jsonResponse({ choices: [{ message: { content: "note" } }] });
    }),
  });

  await provider.invoke({
    modelId: profile.id,
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });

  assert.equal((requestBody as { max_tokens?: unknown }).max_tokens, 8192);
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
      (error as { code?: string }).code === "ai.profile-unavailable",
  );
});

test("diagnoseModelProfile: reports safe metadata for both synthetic probes", async () => {
  const secret = "sk-diagnostic-secret-value";
  const profile: ModelProfile = {
    id: "m-diagnostic",
    name: "Private profile name",
    mode: "custom",
    protocol: "openai",
    apiKey: secret,
    endpoint: "https://user:ignored@example.test/v1?private=query",
    model: "diagnostic-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const bodies: Array<{ max_tokens?: unknown }> = [];
  const safeProfile = {
    ...profile,
    endpoint: "https://example.test/v1?private=query",
  };
  const report = await diagnoseModelProfile(safeProfile, {
    fetchFn: mockFetch(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)) as { max_tokens?: unknown });
      return jsonResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    }),
  });

  assert.equal(report.endpointHost, "example.test");
  assert.equal(report.model, "diagnostic-model");
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.classification),
    ["none", "none"],
  );
  assert.deepEqual(
    report.attempts.map((attempt) => attempt.httpStatus),
    [200, 200],
  );
  assert.deepEqual(
    bodies.map((body) => body.max_tokens),
    [32, 8192],
  );
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(
    serialized,
    /diagnostic-secret|private=query|Private profile/,
  );
  assert.equal(serialized.includes(secret), false);
});

test("diagnoseModelProfile: classifies invalid model JSON without exposing response text", async () => {
  const responseText = "sensitive provider prose";
  const profile: ModelProfile = {
    id: "m-diagnostic-invalid",
    name: "Diagnostic",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://example.test/v1",
    model: "diagnostic-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const report = await diagnoseModelProfile(profile, {
    fetchFn: mockFetch(async () =>
      jsonResponse({ choices: [{ message: { content: responseText } }] }),
    ),
  });
  assert.ok(
    report.attempts.every(
      (attempt) => attempt.classification === "invalid-model-json",
    ),
  );
  assert.equal(JSON.stringify(report).includes(responseText), false);
  assert.equal(JSON.stringify(report).includes(VALID_KEY), false);
});

test("diagnoseModelProfile: classifies bounded timeouts", async () => {
  const profile: ModelProfile = {
    id: "m-diagnostic-timeout",
    name: "Diagnostic",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint: "https://example.test/v1",
    model: "diagnostic-model",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const report = await diagnoseModelProfile(profile, {
    fetchFn: mockFetch(
      async () => await new Promise<Response>(() => undefined),
    ),
    timeoutMs: 5,
  });
  assert.ok(
    report.attempts.every((attempt) => attempt.classification === "timeout"),
  );
});

// ── Reasoning-model response classification ────────────────────────────────

function customProfile(id: string, endpoint: string): ModelProfile {
  return {
    id,
    name: "Custom",
    mode: "custom",
    protocol: "openai",
    apiKey: VALID_KEY,
    endpoint,
    model: "deepseek-v4-flash",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function invokeWith(
  provider: ReturnType<typeof createProfileBackedProvider>,
  body: unknown,
) {
  return provider.invoke({
    modelId: "m-classify",
    prompt: { id: "p", version: 1, template: "T" },
    input: { text: "meta" },
    signal: new AbortController().signal,
  });
}

test("createProfileBackedProvider: reasoning-only responses are attributed, not generic failures", async () => {
  const provider = createProfileBackedProvider({
    resolve: async () =>
      customProfile("m-classify", "https://api.example.test/v1"),
    fetchFn: mockFetch(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "",
              reasoning_content: "Let me think about the rules…",
            },
            finish_reason: "length",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 8192,
          total_tokens: 8292,
          completion_tokens_details: { reasoning_tokens: 8192 },
        },
      }),
    ),
  });
  await assert.rejects(
    () => invokeWith(provider, {}),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: unknown }).code === "ai.provider-invalid-response" &&
      (error as { detail?: unknown }).detail === "reasoning-only",
  );
});

test("createProfileBackedProvider: not-json and empty-content responses are distinguished", async () => {
  const provider = createProfileBackedProvider({
    resolve: async () =>
      customProfile("m-classify", "https://api.example.test/v1"),
    fetchFn: mockFetch(
      async () => new Response("<html>gateway</html>", { status: 200 }),
    ),
  });
  await assert.rejects(
    () => invokeWith(provider, {}),
    (error: unknown) => (error as { detail?: unknown }).detail === "not-json",
  );
});

test("createProfileBackedProvider: usage including reasoning tokens is extracted", async () => {
  const provider = createProfileBackedProvider({
    resolve: async () =>
      customProfile("m-classify", "https://api.example.test/v1"),
    fetchFn: mockFetch(async () =>
      jsonResponse({
        choices: [{ message: { content: "note" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 640,
          total_tokens: 760,
          completion_tokens_details: { reasoning_tokens: 500 },
        },
      }),
    ),
  });
  const response = await invokeWith(provider, {});
  assert.equal(response.text, "note");
  assert.deepEqual(response.usage, {
    inputTokens: 120,
    outputTokens: 640,
    totalTokens: 760,
    reasoningTokens: 500,
  });
  assert.equal(response.finishReason, "stop");
});
