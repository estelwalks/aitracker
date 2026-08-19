/**
 * Server-only model profile persistence + connection testing (S-500).
 *
 * Storage is supplied by the application composition root's SQLite model
 * profile repository. The API key is persisted because it must be usable for
 * real model calls, but it never crosses the renderer boundary: every public
 * read path returns `ModelProfileView` (a boolean `apiKeyMasked`), and
 * `getProfileForExecution` is the only key-bearing accessor — used exclusively
 * by server-side execution (distillation) and connection tests.
 *
 * This module is `*.server.ts`: it is dynamically imported by server fns and
 * transports, never statically imported from a renderer-visible module.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { SystemClock } from "../../platform/persistence/clock.ts";
import type { Clock } from "../../platform/persistence/contracts.ts";
import type { JsonSchema } from "../../test-support/json-schema.ts";
import {
  defaultAuth,
  effectiveAuth,
  effectiveEndpoint,
  effectiveModel,
  effectiveProtocol,
  OFFICIAL_ENDPOINT,
  OFFICIAL_MODEL,
  protocolMeta,
  toModelProfileView,
  validateModelProfileInput,
  type ModelProfile,
  type ModelProfileErrorCode,
  type ModelProfileInput,
  type ModelProfileTestResult,
  type ModelProfileValidation,
  type ModelProfileView,
  type ModelListResult,
  type ProfileAuth,
  type ProfileProtocol,
} from "./model-profile.ts";
import type {
  AIModelProvider,
  AIProviderRequest,
  AIResponse,
} from "./contracts.ts";

export const MODEL_PROFILES_SCHEMA_VERSION = 1 as const;
export const DEFAULT_MODEL_PROFILE_TEST_TIMEOUT_MS = 5_000;

const opaqueId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

const StoredProfileSchema = z
  .object({
    id: opaqueId,
    name: z.string().min(1).max(64),
    mode: z.enum(["official", "custom"]),
    protocol: z.enum(["openai", "anthropic"]),
    apiKey: z.string().min(8).max(512).optional(),
    endpoint: z.string().min(1).max(2048).optional(),
    model: z.string().min(1).max(120).optional(),
    auth: z.enum(["x-api-key", "bearer"]).optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

/** Inner `data` payload of the persisted document. */
export const ModelProfilesFileSchema = z
  .object({
    profiles: z.array(StoredProfileSchema),
    activeProfileId: z.string().min(1).max(128).nullable(),
  })
  .strict();
export type ModelProfilesFile = z.infer<typeof ModelProfilesFileSchema>;

export const DEFAULT_MODEL_PROFILES_FILE: ModelProfilesFile = {
  profiles: [],
  activeProfileId: null,
};

export function modelProfilesSchema(): JsonSchema<ModelProfilesFile> {
  return {
    currentVersion: MODEL_PROFILES_SCHEMA_VERSION,
    parse(value: unknown): ModelProfilesFile {
      return ModelProfilesFileSchema.parse(value);
    },
  };
}

/** Stable error thrown by repository mutations for renderer-safe mapping. */
export class ModelProfileError extends Error {
  readonly name = "ModelProfileError";
  constructor(readonly code: ModelProfileErrorCode) {
    super(code);
  }
}

function isModelProfileError(error: unknown): error is ModelProfileError {
  return error instanceof ModelProfileError;
}

/** Shared request body builder; `maxTokens` differs for ping vs. real calls. */
function chatRequestBody(
  protocol: ProfileProtocol,
  model: string,
  content: string,
  maxTokens: number,
): string {
  return JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });
}

function chatHeaders(
  protocol: ProfileProtocol,
  apiKey: string,
  auth?: ProfileAuth,
): Record<string, string> {
  const scheme = auth ?? defaultAuth(protocol);
  if (protocol === "anthropic") {
    return scheme === "bearer"
      ? {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
          "anthropic-version": "2023-06-01",
        }
      : {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        };
  }
  return {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };
}

export function chatUrl(protocol: ProfileProtocol, endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return protocol === "anthropic"
    ? `${base}/messages`
    : `${base}/chat/completions`;
}

/** Model-list endpoint: `GET {base}/models` (chatUrl is the POST chat path). */
export function modelListUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/models`;
}

function listHeaders(
  protocol: ProfileProtocol,
  apiKey: string,
  auth?: ProfileAuth,
): Record<string, string> {
  const scheme = auth ?? defaultAuth(protocol);
  if (protocol === "anthropic") {
    return scheme === "bearer"
      ? { authorization: `Bearer ${apiKey}`, "anthropic-version": "2023-06-01" }
      : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  return { authorization: `Bearer ${apiKey}` };
}

/** Well-known model ids per provider host, used as an offline fallback. */
const KNOWN_MODEL_LISTS: Record<string, readonly string[]> = {
  "api.deepseek.com": ["deepseek-chat", "deepseek-reasoner"],
  "api.openai.com": [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "o4-mini",
  ],
  "api.moonshot.cn": [
    "moonshot-v1-8k",
    "moonshot-v1-32k",
    "moonshot-v1-128k",
    "kimi-k2",
  ],
  "api.anthropic.com": [
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
    "claude-3-7-sonnet-20250219",
    "claude-3-5-haiku-20241022",
  ],
};

const DEFAULT_MODEL_LISTS: Record<ProfileProtocol, readonly string[]> = {
  openai: KNOWN_MODEL_LISTS["api.openai.com"]!,
  anthropic: KNOWN_MODEL_LISTS["api.anthropic.com"]!,
};

/**
 * Provider default list when the live request fails: match the endpoint
 * hostname against known providers, else fall back to the protocol default.
 */
function fallbackModelList(
  protocol: ProfileProtocol,
  endpoint: string,
): readonly string[] {
  try {
    const host = new URL(endpoint).hostname;
    return KNOWN_MODEL_LISTS[host] ?? DEFAULT_MODEL_LISTS[protocol];
  } catch {
    return DEFAULT_MODEL_LISTS[protocol];
  }
}

function parseChatText(protocol: ProfileProtocol, raw: string): string {
  try {
    const json: unknown = JSON.parse(raw);
    if (protocol === "anthropic") {
      const content = (json as { content?: Array<{ text?: string }> })?.content;
      if (Array.isArray(content))
        return content
          .map((item) => item?.text ?? "")
          .join("\n")
          .trim();
      return "";
    }
    const choice = (
      json as { choices?: Array<{ message?: { content?: string } }> }
    )?.choices?.[0];
    return (choice?.message?.content ?? "").trim();
  } catch {
    return "";
  }
}

export interface ModelProfileRepository {
  /** Renderer-safe projection of every profile (no apiKey anywhere). */
  listViews(): Promise<ModelProfileView[]>;
  /** Active profile projection, or the first profile when none is marked. */
  getActiveView(): Promise<ModelProfileView | null>;
  /**
   * Server-only accessor returning the full profile including the apiKey.
   * Never call this from a renderer-visible path.
   */
  getProfileForExecution(id: string): Promise<ModelProfile | undefined>;
  /** Create or update a profile; a new profile becomes active. */
  upsert(input: ModelProfileInput): Promise<ModelProfileView>;
  /** Remove a profile; deleting the active one activates the first survivor. */
  remove(
    id: string,
  ): Promise<{ ok: true } | { ok: false; errorCode: ModelProfileErrorCode }>;
  setActive(
    id: string,
  ): Promise<{ ok: true } | { ok: false; errorCode: ModelProfileErrorCode }>;
  /** One minimal completion call with a short timeout. Never returns a key. */
  test(input: ModelProfileInput): Promise<ModelProfileTestResult>;
  /**
   * List remote models via `GET {endpoint}/models`. Falls back to a known
   * provider default list when the live request fails. Never returns a key.
   */
  listModels(input: ModelProfileInput): Promise<ModelListResult>;
}

export interface ModelProfileRepositoryOptions {
  /** Injectable document port retained for focused repository unit tests. */
  readonly store: {
    read(): Promise<{ readonly value: ModelProfilesFile }>;
    write(value: ModelProfilesFile): Promise<void>;
  };
  readonly clock?: Clock;
  /** Injectable for unit tests; defaults to the global fetch. */
  readonly fetchFn?: typeof fetch;
  readonly testTimeoutMs?: number;
}

export function createModelProfileRepository(
  options: ModelProfileRepositoryOptions,
): ModelProfileRepository {
  const clock = options.clock ?? new SystemClock();
  const fetchImpl = options.fetchFn ?? fetch;
  const testTimeoutMs =
    options.testTimeoutMs ?? DEFAULT_MODEL_PROFILE_TEST_TIMEOUT_MS;

  async function read(): Promise<ModelProfilesFile> {
    const result = await options.store.read();
    return result.value;
  }

  async function write(file: ModelProfilesFile): Promise<void> {
    await options.store.write(file);
  }

  function nextId(): string {
    return `m-${randomUUID()}`;
  }

  return {
    async listViews() {
      const file = await read();
      return file.profiles.map(toModelProfileView);
    },

    async getActiveView() {
      const file = await read();
      const active =
        file.profiles.find((item) => item.id === file.activeProfileId) ??
        file.profiles[0] ??
        null;
      return active ? toModelProfileView(active) : null;
    },

    async getProfileForExecution(id) {
      const file = await read();
      return file.profiles.find((item) => item.id === id);
    },

    async upsert(input) {
      const isUpdate = input.id != null;
      const validation = validateModelProfileInput(input, isUpdate);
      if (!validation.ok) throw new ModelProfileError(validation.errorCode);
      const now = clock.now().toISOString();
      const name = (
        input.name?.trim() ||
        (input.mode === "official"
          ? OFFICIAL_MODEL
          : input.model?.trim() || "untitled")
      ).slice(0, 64);
      const protocol = effectiveProtocol(input.mode, input.protocol);

      let profile: ModelProfile;
      let next: ModelProfilesFile;
      if (isUpdate) {
        const file = await read();
        const existing = file.profiles.find((item) => item.id === input.id);
        if (!existing)
          throw new ModelProfileError("errors.modelProfile.notFound");
        profile = {
          ...existing,
          name,
          mode: input.mode,
          protocol,
          auth: input.auth ?? existing.auth ?? defaultAuth(protocol),
          ...(input.apiKey?.trim()
            ? { apiKey: input.apiKey.trim() }
            : existing.apiKey
              ? { apiKey: existing.apiKey }
              : {}),
          ...(input.mode === "official"
            ? { endpoint: OFFICIAL_ENDPOINT, model: OFFICIAL_MODEL }
            : {
                ...(input.endpoint?.trim()
                  ? { endpoint: input.endpoint.trim() }
                  : {}),
                ...(input.model?.trim() ? { model: input.model.trim() } : {}),
              }),
          updatedAt: now,
        };
        next = {
          ...file,
          profiles: file.profiles.map((item) =>
            item.id === input.id ? profile : item,
          ),
          activeProfileId: profile.id,
        };
      } else {
        profile = {
          id: nextId(),
          name,
          mode: input.mode,
          protocol,
          apiKey: input.apiKey?.trim(),
          auth: effectiveAuth({ mode: input.mode, protocol, auth: input.auth }),
          ...(input.mode === "official"
            ? { endpoint: OFFICIAL_ENDPOINT, model: OFFICIAL_MODEL }
            : {
                ...(input.endpoint?.trim()
                  ? { endpoint: input.endpoint.trim() }
                  : {}),
                ...(input.model?.trim() ? { model: input.model.trim() } : {}),
              }),
          createdAt: now,
          updatedAt: now,
        };
        const file = await read();
        next = {
          ...file,
          profiles: [...file.profiles, profile],
          activeProfileId: profile.id,
        };
      }
      await write(next);
      return toModelProfileView(profile);
    },

    async remove(id) {
      const file = await read();
      const target = file.profiles.find((item) => item.id === id);
      if (!target)
        return { ok: false, errorCode: "errors.modelProfile.notFound" };
      const profiles = file.profiles.filter((item) => item.id !== id);
      const activeProfileId =
        file.activeProfileId === id
          ? (profiles[0]?.id ?? null)
          : file.activeProfileId;
      await write({ profiles, activeProfileId });
      return { ok: true };
    },

    async setActive(id) {
      const file = await read();
      if (!file.profiles.some((item) => item.id === id))
        return { ok: false, errorCode: "errors.modelProfile.notFound" };
      await write({ ...file, activeProfileId: id });
      return { ok: true };
    },

    async test(input) {
      const effective = await resolveTestConfig(input, read);
      const validation: ModelProfileValidation = validateModelProfileInput(
        {
          mode: effective.mode,
          protocol: effective.protocol,
          apiKey: effective.apiKey,
          endpoint: effective.endpoint,
          model: effective.model,
          // Name is not used by the ping itself but is part of the payload
          // contract; reuse the form's value so custom validation passes.
          name: input.name ?? "",
        },
        input.id != null,
      );
      if (!validation.ok) return { ok: false, errorCode: validation.errorCode };

      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), testTimeoutMs);
      try {
        const response = await fetchImpl(
          chatUrl(effective.protocol, effective.endpoint),
          {
            method: "POST",
            headers: chatHeaders(
              effective.protocol,
              effective.apiKey,
              effective.auth,
            ),
            body: chatRequestBody(
              effective.protocol,
              effective.model,
              "ping",
              16,
            ),
            signal: controller.signal,
          },
        );
        if (!response.ok)
          return { ok: false, errorCode: "errors.modelProfile.testFailed" };
        // Drain the body so connection-level failures still surface as errors.
        await response.text();
        return { ok: true, latencyMs: Date.now() - started };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, errorCode: "errors.modelProfile.testTimeout" };
        }
        void error;
        return { ok: false, errorCode: "errors.modelProfile.testFailed" };
      } finally {
        clearTimeout(timer);
      }
    },

    async listModels(input) {
      const effective = await resolveTestConfig(input, read);
      if (!effective.apiKey) {
        return { ok: false, errorCode: "errors.modelProfile.listFailed" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), testTimeoutMs);
      try {
        const response = await fetchImpl(modelListUrl(effective.endpoint), {
          method: "GET",
          headers: listHeaders(
            effective.protocol,
            effective.apiKey,
            effective.auth,
          ),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = (await response.json()) as {
          data?: Array<{ id?: string }>;
        };
        const models = (payload.data ?? [])
          .map((item) => item?.id?.trim() ?? "")
          .filter((id) => id.length > 0)
          .sort();
        if (models.length === 0) throw new Error("empty model list");
        return { ok: true, models, source: "remote" };
      } catch {
        return {
          ok: true,
          models: fallbackModelList(effective.protocol, effective.endpoint),
          source: "fallback",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Merge the form payload with the stored secret when editing with an empty
 * key, then apply protocol defaults so the ping always has a usable config.
 */
async function resolveTestConfig(
  input: ModelProfileInput,
  read: () => Promise<ModelProfilesFile>,
): Promise<{
  mode: ModelProfile["mode"];
  protocol: ProfileProtocol;
  apiKey: string;
  endpoint: string;
  model: string;
  auth: ProfileAuth;
}> {
  let mode = input.mode;
  let protocol = effectiveProtocol(input.mode, input.protocol);
  let apiKey = input.apiKey?.trim() ?? "";
  let endpoint =
    input.endpoint?.trim() ||
    (mode === "official" ? OFFICIAL_ENDPOINT : protocolMeta[protocol].endpoint);
  let model =
    mode === "official" ? OFFICIAL_MODEL : (input.model?.trim() ?? "");
  let storedAuth: ProfileAuth | undefined;
  let storedProtocol: ProfileProtocol | undefined;

  if (!apiKey && input.id != null) {
    const file = await read();
    const stored = file.profiles.find((item) => item.id === input.id);
    if (stored) {
      apiKey = stored.apiKey ?? "";
      if (!input.endpoint?.trim() && stored.endpoint)
        endpoint = stored.endpoint;
      if (!input.model?.trim() && stored.model) model = stored.model;
      mode = stored.mode;
      protocol = stored.protocol;
      storedAuth = stored.auth;
      storedProtocol = stored.protocol;
    }
  }
  const auth =
    input.auth ?? storedAuth ?? defaultAuth(storedProtocol ?? protocol);
  return { mode, protocol, apiKey, endpoint, model, auth };
}

/**
 * Provider adapter that resolves a saved profile at invoke time by
 * `request.modelId` and performs a real chat-completion call. Registered in
 * the composition root under the stable id `profile`; distillation requests
 * route here by setting `providerId: "profile"` when a profile id is selected.
 * A missing/expired profile or transport failure throws, letting the executor
 * fall back to its deterministic offline response (status `fallback`).
 */
export function createProfileBackedProvider(options: {
  readonly resolve: (profileId: string) => Promise<ModelProfile | undefined>;
  readonly fetchFn?: typeof fetch;
}): AIModelProvider {
  const fetchImpl = options.fetchFn ?? fetch;
  return {
    providerId: "profile",
    async invoke(request: AIProviderRequest): Promise<AIResponse> {
      const profile = await options.resolve(request.modelId);
      if (!profile?.apiKey)
        throw new ModelProfileError("errors.modelProfile.notFound");
      const endpoint = effectiveEndpoint(profile);
      const model = effectiveModel(profile) ?? request.modelId;
      const content =
        `${request.prompt.template}\n\n${request.input.text}`.trim();
      const response = await fetchImpl(chatUrl(profile.protocol, endpoint), {
        method: "POST",
        headers: chatHeaders(
          profile.protocol,
          profile.apiKey,
          effectiveAuth(profile),
        ),
        body: chatRequestBody(profile.protocol, model, content, 1024),
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = parseChatText(profile.protocol, await response.text());
      return {
        providerId: "profile",
        modelId: request.modelId,
        text,
        finishReason: "stop",
      };
    },
  };
}

export { isModelProfileError };
export type { ModelProfileValidation };
