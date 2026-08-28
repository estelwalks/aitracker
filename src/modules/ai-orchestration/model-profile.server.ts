/**
 * Server-only model profile connection helpers + provider adapter (S-500).
 *
 * Storage is supplied by the application composition root's SQLite model
 * profile repository (`createSqliteModelProfileRepository`). The API key is
 * persisted encrypted because it must be usable for real model calls, but it
 * never crosses the renderer boundary: every public read path returns
 * `ModelProfileView` (a boolean `apiKeyMasked`), and `getProfileForExecution`
 * is the only key-bearing accessor — used exclusively by server-side model
 * execution, connection tests and the explicit developer diagnostic command.
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
  AIErrorCode,
  AIModelProvider,
  AIProviderRequest,
  AIResponse,
} from "./contracts.ts";

class ProfileProviderInvocationError extends Error {
  readonly name = "ProfileProviderInvocationError";
  constructor(
    readonly code: AIErrorCode,
    /** Sanitized, bounded failure attribution (never raw response text). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

function httpFailureCode(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "ai.provider-auth";
  if (status === 429) return "ai.provider-rate-limited";
  if (status >= 500) return "ai.provider-unavailable";
  return "ai.provider-http-client";
}

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

function requestBody(
  mode: ModelProfileInput["mode"],
  protocol: ProfileProtocol,
  model: string,
  content: string,
  maxTokens: number,
): string {
  if (mode === "official" || protocol === "openai-responses") {
    return JSON.stringify({
      model,
      max_output_tokens: maxTokens,
      input: content,
    });
  }
  return chatRequestBody(protocol, model, content, maxTokens);
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
  if (/\/(?:chat\/completions|messages|responses)$/u.test(base)) return base;
  if (protocol === "openai-responses") return `${base}/responses`;
  return protocol === "anthropic"
    ? /\/v\d+$/u.test(base)
      ? `${base}/messages`
      : `${base}/v1/messages`
    : `${base}/chat/completions`;
}

/** Recommended profiles use the OpenAI Responses API; custom profiles retain their selected protocol. */
export function modelRequestUrl(
  mode: ModelProfileInput["mode"],
  protocol: ProfileProtocol,
  endpoint: string,
): string {
  if (mode !== "official" && protocol !== "openai-responses")
    return chatUrl(protocol, endpoint);
  const base = endpoint.replace(/\/+$/, "");
  return /\/responses$/u.test(base) ? base : `${base}/responses`;
}

/** Model-list endpoint: `GET {base}/models` (chatUrl is the POST chat path). */
export function modelListUrl(endpoint: string): string {
  return `${endpoint.replace(/\/+$/, "")}/models`;
}

const MODEL_PROFILE_NETWORK_TIMEOUT_MS = 12_000;
const DEFAULT_PROFILE_MAX_OUTPUT_TOKENS = 8192;
const MAX_TRANSIENT_CHAT_RETRIES = 2;
const TRANSIENT_CHAT_RETRY_DELAY_MS = 350;

function isTransientChatStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

async function waitBeforeChatRetry(): Promise<void> {
  await new Promise<void>((resolve) =>
    setTimeout(resolve, TRANSIENT_CHAT_RETRY_DELAY_MS),
  );
}

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
          fetchImpl(modelRequestUrl(input.mode, protocol, endpoint), {
            method: "POST",
            headers: chatHeaders(protocol, apiKey, effectiveAuth(input)),
            body: requestBody(
              input.mode,
              protocol,
              model,
              "Reply with OK.",
              16,
            ),
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
    const failureResult = (reason: string): ModelListResult => ({
      ok: false,
      source: "fallback",
      message: `Remote model list unavailable (${reason}).`,
      errorCode: "errors.modelProfile.listFailed",
    });
    const apiKey = input.apiKey?.trim() ?? "";
    if (!apiKey) return failureResult("API key is missing");
    if (!endpointIsValid(endpoint)) return failureResult("base URL is invalid");

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
      if (!response.ok)
        return failureResult(
          `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
        );
      const payload = await withNetworkTimeout(
        () => response.json(),
        timeoutMs,
      );
      const ids = parseRemoteModelIds(payload);
      if (ids.length === 0) return failureResult("empty response");
      return {
        ok: true,
        models: ids,
        source: "remote",
        message: `Fetched ${ids.length} models from the remote endpoint.`,
      };
    } catch (error) {
      return failureResult(safeNetworkMessage(error));
    }
  }

  return { test, listModels };
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as { text?: unknown; content?: unknown };
      return typeof record.text === "string"
        ? record.text
        : typeof record.content === "string"
          ? record.content
          : "";
    })
    .join("\n")
    .trim();
}

export type ChatResponseClassification =
  "ok" | "not-json" | "empty-content" | "reasoning-only" | "no-text-field";

export interface ClassifiedChatResponse {
  readonly text: string;
  readonly kind: ChatResponseClassification;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly finishReason?: AIResponse["finishReason"];
}

function parseChatUsage(
  usage: unknown,
):
  | Pick<
      ClassifiedChatResponse,
      "inputTokens" | "outputTokens" | "totalTokens" | "reasoningTokens"
    >
  | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const inputTokens =
    typeof record.prompt_tokens === "number"
      ? record.prompt_tokens
      : typeof record.input_tokens === "number"
        ? record.input_tokens
        : undefined;
  const outputTokens =
    typeof record.completion_tokens === "number"
      ? record.completion_tokens
      : typeof record.output_tokens === "number"
        ? record.output_tokens
        : undefined;
  if (inputTokens === undefined || outputTokens === undefined) return undefined;
  const details = record.completion_tokens_details as
    { reasoning_tokens?: unknown } | undefined;
  const reasoningTokens =
    details && typeof details.reasoning_tokens === "number"
      ? details.reasoning_tokens
      : undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      typeof record.total_tokens === "number"
        ? record.total_tokens
        : inputTokens + outputTokens,
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

/**
 * Parses a chat-completion response and classifies the outcome. Reasoning
 * models (e.g. deepseek-v4-flash) frequently exhaust the output budget on
 * `reasoning_content` and return an empty `content`; distinguishing
 * `reasoning-only` from `empty-content` and `not-json` is what makes failure
 * attribution actionable.
 */
function parseChatCompletion(
  protocol: ProfileProtocol,
  raw: string,
): ClassifiedChatResponse {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { text: "", kind: "not-json" };
  }
  let content: unknown;
  let reasoningContent: unknown;
  let usage: unknown;
  let finishReason: unknown;
  if (protocol === "anthropic") {
    const record = json as {
      content?: unknown;
      usage?: unknown;
      stop_reason?: unknown;
    };
    content = record.content;
    usage = record.usage;
    finishReason = record.stop_reason;
  } else {
    const record = json as {
      choices?: Array<{
        text?: unknown;
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
        };
        finish_reason?: unknown;
      }>;
      output_text?: unknown;
      output?: Array<{ content?: unknown }>;
      usage?: unknown;
    };
    const choice = record.choices?.[0];
    content =
      textFromContent(choice?.message?.content) ||
      textFromContent(choice?.text) ||
      textFromContent(record.output_text) ||
      textFromContent(record.output?.flatMap((item) => item.content ?? [])) ||
      "";
    reasoningContent = choice?.message?.reasoning_content;
    finishReason = choice?.finish_reason;
    usage = record.usage;
  }
  const text = textFromContent(content);
  const reasoning = textFromContent(reasoningContent);
  const kind: ChatResponseClassification =
    text.length > 0
      ? "ok"
      : reasoning.length > 0
        ? "reasoning-only"
        : "empty-content";
  return {
    text,
    kind,
    ...(parseChatUsage(usage) ?? {}),
    ...(typeof finishReason === "string" &&
    (finishReason === "stop" || finishReason === "length")
      ? { finishReason }
      : {}),
  };
}

function parseChatText(protocol: ProfileProtocol, raw: string): string {
  return parseChatCompletion(protocol, raw).text;
}

export type ModelDiagnosticFailureClassification =
  | "none"
  | "timeout"
  | "http-error"
  | "network-error"
  | "invalid-response-json"
  | "empty-model-output"
  | "invalid-model-json";

export interface ModelDiagnosticAttempt {
  readonly kind: "connectivity" | "insight-json";
  readonly httpStatus: number | null;
  readonly durationMs: number;
  /** Whether the provider's outer HTTP response envelope is valid JSON. */
  readonly responseJsonParseable: boolean;
  /** Whether the model content itself is a JSON value. */
  readonly modelJsonParseable: boolean;
  readonly classification: ModelDiagnosticFailureClassification;
}

export interface ModelDiagnosticReport {
  /** Host only: excludes path, query, credentials and secret material. */
  readonly endpointHost: string;
  readonly model: string;
  readonly attempts: readonly ModelDiagnosticAttempt[];
}

export interface ModelDiagnosticOptions {
  readonly fetchFn?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

const DIAGNOSTIC_TIMEOUT_MS = 30_000;

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

async function runDiagnosticAttempt(input: {
  readonly kind: ModelDiagnosticAttempt["kind"];
  readonly profile: ModelProfile;
  readonly model: string;
  readonly content: string;
  readonly maxOutputTokens: number;
  readonly fetchFn: typeof fetch;
  readonly timeoutMs: number;
  readonly now: () => number;
}): Promise<ModelDiagnosticAttempt> {
  const startedAt = input.now();
  let httpStatus: number | null = null;
  try {
    const exchange = await withNetworkTimeout(async (signal) => {
      const response = await input.fetchFn(
        modelRequestUrl(
          input.profile.mode,
          input.profile.protocol,
          effectiveEndpoint(input.profile),
        ),
        {
          method: "POST",
          headers: chatHeaders(
            input.profile.protocol,
            input.profile.apiKey!,
            effectiveAuth(input.profile),
          ),
          body: requestBody(
            input.profile.mode,
            input.profile.protocol,
            input.model,
            input.content,
            input.maxOutputTokens,
          ),
          signal,
        },
      );
      httpStatus = response.status;
      return {
        ok: response.ok,
        status: response.status,
        raw: await response.text(),
      };
    }, input.timeoutMs);
    httpStatus = exchange.status;
    const raw = exchange.raw;
    const responseJsonParseable = isJson(raw);
    const modelText = responseJsonParseable
      ? parseChatText(input.profile.protocol, raw)
      : "";
    const modelJsonParseable = modelText !== "" && isJson(modelText);
    let classification: ModelDiagnosticFailureClassification = "none";
    if (!exchange.ok) classification = "http-error";
    else if (!responseJsonParseable) classification = "invalid-response-json";
    else if (!modelText) classification = "empty-model-output";
    else if (!modelJsonParseable) classification = "invalid-model-json";
    return {
      kind: input.kind,
      httpStatus,
      durationMs: Math.max(0, input.now() - startedAt),
      responseJsonParseable,
      modelJsonParseable,
      classification,
    };
  } catch (error) {
    return {
      kind: input.kind,
      httpStatus,
      durationMs: Math.max(0, input.now() - startedAt),
      responseJsonParseable: false,
      modelJsonParseable: false,
      classification:
        error instanceof ModelProfileNetworkTimeout
          ? "timeout"
          : "network-error",
    };
  }
}

/**
 * Runs two synthetic, privacy-safe probes against a fully resolved profile.
 * The returned report never includes headers, prompts, response text or keys.
 */
export async function diagnoseModelProfile(
  profile: ModelProfile,
  options: ModelDiagnosticOptions = {},
): Promise<ModelDiagnosticReport> {
  if (!profile.apiKey) {
    throw new ModelProfileError("errors.modelProfile.apiKeyRequired");
  }
  const endpoint = effectiveEndpoint(profile);
  if (!endpointIsValid(endpoint)) {
    throw new ModelProfileError("errors.modelProfile.invalidUrl");
  }
  const model = effectiveModel(profile);
  if (!model) {
    throw new ModelProfileError("errors.modelProfile.invalidModel");
  }
  const timeoutMs = options.timeoutMs ?? DIAGNOSTIC_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError("timeoutMs must be an integer from 1 to 120000");
  }
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const common = { profile, model, fetchFn, timeoutMs, now };
  const attempts = [] as ModelDiagnosticAttempt[];
  attempts.push(
    await runDiagnosticAttempt({
      ...common,
      kind: "connectivity",
      content: 'Return exactly this JSON object: {"ok":true}',
      maxOutputTokens: 32,
    }),
  );
  attempts.push(
    await runDiagnosticAttempt({
      ...common,
      kind: "insight-json",
      content: [
        "Return one JSON object only, without markdown.",
        'Required shape: {"lines":[{"candidateId":"diagnostic","analysis":"brief sentence"}]}',
        'Synthetic input: {"surface":"dashboard","locale":"en-US","candidates":[{"id":"diagnostic","severity":"attention","fact":"A local aggregate needs attention","actionIds":[],"mandatory":true}]}',
      ].join("\n"),
      maxOutputTokens: 8192,
    }),
  );
  return {
    endpointHost: new URL(endpoint).host,
    model,
    attempts,
  };
}

export interface ModelProfileRepository {
  /** Renderer-safe projection of every profile (no apiKey anywhere). */
  listViews(): Promise<ModelProfileView[]>;
  /** Explicitly active profile projection; null when no profile is enabled. */
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
   * List remote models via `GET {endpoint}/models`. A failed request returns no
   * model list and includes a sanitized reason. Never returns a key.
   */
  listModels(input: ModelProfileInput): Promise<ModelListResult>;
}

/**
 * Resolve credentials only for the explicitly enabled profile.
 *
 * Shared (browser-safe) lookup so model consumers never silently fall back to
 * the first configured profile when the user has not enabled one. Defined in
 * `model-profile.ts` and re-exported from the public module index.
 */
export { getActiveModelProfileForExecution } from "./model-profile.ts";

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
        throw new ProfileProviderInvocationError("ai.profile-unavailable");
      const endpoint = effectiveEndpoint(profile);
      const model = effectiveModel(profile) ?? request.modelId;
      const content =
        `${request.prompt.template}\n\n${request.input.text}`.trim();
      const maxOutputTokens =
        request.maxOutputTokens ?? DEFAULT_PROFILE_MAX_OUTPUT_TOKENS;
      const requestInit: RequestInit = {
        method: "POST",
        headers: chatHeaders(
          profile.protocol,
          profile.apiKey,
          effectiveAuth(profile),
        ),
        body: requestBody(
          profile.mode,
          profile.protocol,
          model,
          content,
          maxOutputTokens,
        ),
        signal: request.signal,
      };
      let response: Response | undefined;
      for (
        let attempt = 0;
        attempt <= MAX_TRANSIENT_CHAT_RETRIES;
        attempt += 1
      ) {
        if (request.signal.aborted) throw new Error("request cancelled");
        try {
          response = await fetchImpl(
            modelRequestUrl(profile.mode, profile.protocol, endpoint),
            requestInit,
          );
        } catch (error) {
          if (request.signal.aborted) throw error;
          if (attempt === MAX_TRANSIENT_CHAT_RETRIES) {
            throw new ProfileProviderInvocationError("ai.provider-network");
          }
          await waitBeforeChatRetry();
          continue;
        }
        if (
          response.ok ||
          !isTransientChatStatus(response.status) ||
          attempt === MAX_TRANSIENT_CHAT_RETRIES
        ) {
          break;
        }
        await waitBeforeChatRetry();
      }
      if (response === undefined)
        throw new ProfileProviderInvocationError(
          "ai.provider-invalid-response",
        );
      if (!response.ok)
        throw new ProfileProviderInvocationError(
          httpFailureCode(response.status),
          `http-error:${response.status}`,
        );
      const parsed = parseChatCompletion(
        profile.protocol,
        await response.text(),
      );
      if (parsed.kind !== "ok") {
        // Distinguish reasoning-budget exhaustion from other empty responses
        // so the caller can attribute and retry intelligently.
        throw new ProfileProviderInvocationError(
          "ai.provider-invalid-response",
          parsed.kind,
        );
      }
      return {
        providerId: "profile",
        modelId: request.modelId,
        text: parsed.text,
        finishReason: parsed.finishReason ?? "stop",
        ...(parsed.inputTokens !== undefined &&
        parsed.outputTokens !== undefined &&
        parsed.totalTokens !== undefined
          ? {
              usage: {
                inputTokens: parsed.inputTokens,
                outputTokens: parsed.outputTokens,
                totalTokens: parsed.totalTokens,
                ...(parsed.reasoningTokens !== undefined
                  ? { reasoningTokens: parsed.reasoningTokens }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}
