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
  validateModelProfileInput,
} from "./model-profile.ts";
import {
  chatUrl,
  createProfileBackedProvider,
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
  const directory = mkdtempSync(join(tmpdir(), "tt-model-profile-"));
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
    modelListUrl("https://api.deepseek.com/v1"),
    "https://api.deepseek.com/v1/models",
  );
  assert.equal(
    modelListUrl("https://api.deepseek.com/v1/"),
    "https://api.deepseek.com/v1/models",
  );
});

// ── SQLite repository lifecycle ─────────────────────────────────────────────

test("sqlite repository: upsert creates a key-free view and activates it", async (t) => {
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
    assert.equal(await repository.getActiveView().then((a) => a?.id), view.id);
  });
});

test("sqlite repository: update keeps createdAt and stored key when key is blank", async (t) => {
  await withRepo(t, async (repository) => {
    const created = await repository.upsert(VALID_CUSTOM);
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
    await repository.upsert({ ...VALID_CUSTOM, name: "B" });
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

test("sqlite repository: official mode stores the fixed preset endpoint/model", async (t) => {
  await withRepo(t, async (repository) => {
    const view = await repository.upsert({
      mode: "official",
      name: "官方默认",
      apiKey: VALID_KEY,
    });
    assert.equal(view.protocol, "openai");
    assert.equal(view.endpoint, "https://api.deepseek.com/v1");
    assert.equal(view.model, "deepseek-chat");
    const full = await repository.getProfileForExecution(view.id);
    assert.equal(full?.apiKey, VALID_KEY);
  });
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
