/**
 * Server-only model profile connection helpers + provider adapter (S-500).
 *
 * Storage is supplied by the application composition root's SQLite model
 * profile repository (`createSqliteModelProfileRepository`). The API key is
 * persisted encrypted because it must be usable for real model calls, but it
 * never crosses the renderer boundary: every public read path returns
 * `ModelProfileView` (a boolean `apiKeyMasked`), and `getProfileForExecution`
 * is the only key-bearing accessor — used exclusively by server-side execution
 * (distillation) and connection tests.
 *
 * This module is `*.server.ts`: it is dynamically imported by server fns and
 * transports, never statically imported from a renderer-visible module.
 */

import {
  defaultAuth,
  effectiveAuth,
  effectiveEndpoint,
  effectiveModel,
  effectiveProtocol,
  validateModelProfileInput,
  type ModelListResult,
  type ModelProfile,
  type ModelProfileErrorCode,
  type ModelProfileInput,
  type ModelProfileTestResult,
  type ModelProfileView,
  type ProfileAuth,
  type ProfileProtocol,
} from "./model-profile.ts";
import type {
  AIModelProvider,
  AIProviderRequest,
  AIResponse,
} from "./contracts.ts";

/** Stable error thrown by repository mutations for renderer-safe mapping. */
export class ModelProfileError extends Error {
  readonly name = "ModelProfileError";
  constructor(readonly code: ModelProfileErrorCode) {
    super(code);
  }
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
  return scheme === "x-api-key"
    ? { "content-type": "application/json", "x-api-key": apiKey }
    : { "content-type": "application/json", authorization: `Bearer ${apiKey}` };
}

export function chatUrl(protocol: ProfileProtocol, endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  if (/\/(?:chat\/completions|messages)$/u.test(base)) return base;
  return protocol === "anthropic"
    ? /\/v\d+$/u.test(base)
      ? `${base}/messages`
      : `${base}/v1/messages`
    : `${base}/chat/completions`;
}

/** Model-list endpoint: `GET {base}/models` (chatUrl is the POST chat path). */
export function modelListUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/models`;
}

const MODEL_PROFILE_NETWORK_TIMEOUT_MS = 12_000;
const KNOWN_MODEL_FALLBACKS: Record<ProfileProtocol, readonly string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
  anthropic: [
    "claude-sonnet-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
};
const OFFICIAL_MODEL_FALLBACKS = [
  "deepseek-chat",
  "deepseek-reasoner",
] as const;

class ModelProfileNetworkTimeout extends Error {
  readonly name = "ModelProfileNetworkTimeout";
}

function endpointIsValid(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.length <= 2048 &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function safeNetworkMessage(error: unknown): string {
  if (error instanceof ModelProfileNetworkTimeout) return "request timed out";
  if (error instanceof Error && error.message) {
    return error.message.replace(/[\\\r\n]/gu, " ").slice(0, 160);
  }
  return "request failed";
}

async function withNetworkTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelProfileNetworkTimeout("request timed out"));
    }, timeoutMs);
  });
  const operationPromise = operation(controller.signal).catch(
    (error: unknown) => {
      // Fetch implementations commonly reject with AbortError after the
      // controller is aborted. Preserve the stable timeout code in that race.
      if (controller.signal.aborted)
        throw new ModelProfileNetworkTimeout("request timed out");
      throw error;
    },
  );
  try {
    return await Promise.race([operationPromise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function parseRemoteModelIds(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return parseRemoteModelIds({ models: payload });
  }
  if (!payload || typeof payload !== "object") return [];
  const data =
    (payload as { data?: unknown; models?: unknown; result?: unknown }).data ??
    (payload as { models?: unknown }).models ??
    (payload as { result?: unknown }).result;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as {
        id?: unknown;
        model?: unknown;
        name?: unknown;
      };
      const id = record.id ?? record.model ?? record.name;
      return typeof id === "string" ? id : "";
    })
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9._:/-]{1,120}$/u.test(id));
  return [...new Set(ids)];
}

export interface ModelProfileNetworkOperations {
  readonly test: (input: ModelProfileInput) => Promise<ModelProfileTestResult>;
  readonly listModels: (input: ModelProfileInput) => Promise<ModelListResult>;
}

/** Server-side provider calls used by the SQLite repository actions. */
export function createModelProfileNetworkOperations(options?: {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
}): ModelProfileNetworkOperations {
  const fetchImpl = options?.fetchFn ?? fetch;
  const timeoutMs = options?.timeoutMs ?? MODEL_PROFILE_NETWORK_TIMEOUT_MS;

  async function test(
    input: ModelProfileInput,
  ): Promise<ModelProfileTestResult> {
    const validation = validateModelProfileInput(input, input.id !== undefined);
    if (!validation.ok) return validation;
    const apiKey = input.apiKey?.trim() ?? "";
    if (!apiKey)
      return { ok: false, errorCode: "errors.modelProfile.apiKeyRequired" };
    const protocol = effectiveProtocol(input.mode, input.protocol);
    const endpoint = effectiveEndpoint(input);
    const model = effectiveModel(input);
    if (!model)
      return { ok: false, errorCode: "errors.modelProfile.invalidModel" };
    if (!endpointIsValid(endpoint))
      return { ok: false, errorCode: "errors.modelProfile.invalidUrl" };

    const startedAt = Date.now();
    try {
      const response = await withNetworkTimeout(
        (signal) =>
          fetchImpl(chatUrl(protocol, endpoint), {
            method: "POST",
            headers: chatHeaders(protocol, apiKey, effectiveAuth(input)),
            body: chatRequestBody(protocol, model, "Reply with OK.", 16),
            signal,
          }),
        timeoutMs,
      );
      const latencyMs = Math.max(0, Date.now() - startedAt);
      if (!response.ok)
        return {
          ok: false,
          latencyMs,
          errorCode: "errors.modelProfile.testFailed",
        };
      // A successful HTTP response is sufficient for a connectivity test.
      // Providers differ in their response envelope (and some gateways return
      // an empty body), while the request itself has already exercised the
      // configured endpoint, protocol and credential.
      return { ok: true, latencyMs };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.max(0, Date.now() - startedAt),
        errorCode:
          error instanceof ModelProfileNetworkTimeout
            ? "errors.modelProfile.testTimeout"
            : "errors.modelProfile.testFailed",
      };
    }
  }

  async function listModels(
    input: ModelProfileInput,
  ): Promise<ModelListResult> {
    const endpoint = effectiveEndpoint(input);
    const protocol = effectiveProtocol(input.mode, input.protocol);
    const fallback =
      input.mode === "official"
        ? OFFICIAL_MODEL_FALLBACKS
        : KNOWN_MODEL_FALLBACKS[protocol];
    const fallbackResult = (reason: string): ModelListResult => ({
      ok: true,
      models: fallback,
      source: "fallback",
      message: `Remote model list unavailable (${reason}); showing known ${protocol} models.`,
      errorCode: "errors.modelProfile.listFailed",
    });
    const apiKey = input.apiKey?.trim() ?? "";
    if (!apiKey) return fallbackResult("API key is missing");
    if (!endpointIsValid(endpoint))
      return fallbackResult("base URL is invalid");

    try {
      const response = await withNetworkTimeout(
        (signal) =>
          fetchImpl(modelListUrl(endpoint), {
            method: "GET",
            headers: chatHeaders(protocol, apiKey, effectiveAuth(input)),
            signal,
          }),
        timeoutMs,
      );
      if (!response.ok) return fallbackResult(`HTTP ${response.status}`);
      const payload = await withNetworkTimeout(
        () => response.json(),
        timeoutMs,
      );
      const ids = parseRemoteModelIds(payload);
      if (ids.length === 0) return fallbackResult("empty response");
      return {
        ok: true,
        models: ids,
        source: "remote",
        message: `Fetched ${ids.length} models from the remote endpoint.`,
      };
    } catch (error) {
      return fallbackResult(safeNetworkMessage(error));
    }
  }

  return { test, listModels };
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
  /** Create or update a profile without changing the active profile. */
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
        body: chatRequestBody(profile.protocol, model, content, 8192),
        signal: request.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = parseChatText(profile.protocol, await response.text());
      if (!text) throw new Error("empty model response");
      return {
        providerId: "profile",
        modelId: request.modelId,
        text,
        finishReason: "stop",
      };
    },
  };
}
