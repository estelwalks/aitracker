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
  return protocol === "anthropic"
    ? `${base}/messages`
    : `${base}/chat/completions`;
}

/** Model-list endpoint: `GET {base}/models` (chatUrl is the POST chat path). */
export function modelListUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/models`;
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
