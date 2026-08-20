/**
 * Multi-profile model configuration domain (S-500).
 *
 * Browser-safe by construction: this module contains no Node/Electron imports,
 * only types, protocol metadata, validation and renderer-safe projections. The
 * API key never leaves the server store — the renderer only ever receives
 * `ModelProfileView` (a boolean `apiKeyMasked` instead of the secret).
 *
 * Validation rules: URL protocol http/https without embedded credentials,
 * model charset/length, plus the S-500 spec: name 1..64, model 1..120,
 * apiKey 8..512 for profiles. Official profiles use the built-in managed
 * preset for their endpoint/protocol/model, while their API key is still
 * supplied by the user and stored server-side.
 */

export type ProfileMode = "official" | "custom";
export type ProfileProtocol = "openai" | "anthropic";

/**
 * Auth header scheme used against the endpoint. Some Anthropic-format gateways
 * (e.g. company proxies in front of DeepSeek) require `Authorization: Bearer`
 * instead of the stock `x-api-key` header.
 */
export type ProfileAuth = "x-api-key" | "bearer";

/** Default auth scheme for a protocol (openai → Bearer, anthropic → x-api-key). */
export function defaultAuth(protocol: ProfileProtocol): ProfileAuth {
  return protocol === "anthropic" ? "x-api-key" : "bearer";
}

/** Model used by the built-in official DeepSeek profile preset. */
export const OFFICIAL_MODEL = "deepseek-chat";
/** Product-facing label shown beneath the official model entry. */
export const OFFICIAL_MODEL_DISPLAY_NAME = "DeepSeek-V4-Flash";
export const OFFICIAL_ENDPOINT = "https://api.deepseek.com";
export const OFFICIAL_PROTOCOL: ProfileProtocol = "openai";

/** Max length constraints shared by validation and the settings form. */
export const PROFILE_NAME_MAX = 64;
export const PROFILE_MODEL_MAX = 120;
export const PROFILE_ENDPOINT_MAX = 2048;
export const PROFILE_API_KEY_MIN = 8;
export const PROFILE_API_KEY_MAX = 512;

/** Same charset the env-probe accepts for model ids (config.ts). */
export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/;

export interface ProtocolMeta {
  /** Default endpoint used when the profile leaves it empty. */
  readonly endpoint: string;
  /** Request path shown in the form (documentation only). */
  readonly path: string;
  /** Auth header shape shown in the form (documentation only). */
  readonly auth: string;
}

export const protocolMeta: Record<ProfileProtocol, ProtocolMeta> = {
  openai: {
    endpoint: "https://api.openai.com/v1",
    path: "POST /chat/completions",
    auth: "Authorization: Bearer <API Key>",
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1",
    path: "POST /messages",
    auth: "x-api-key: <API Key> · anthropic-version: 2023-06-01",
  },
};

/** Full profile as stored server-side. The apiKey is secret material. */
export interface ModelProfile {
  readonly id: string;
  readonly name: string;
  readonly mode: ProfileMode;
  readonly protocol: ProfileProtocol;
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
  /** Auth header scheme; defaults to the protocol default when absent. */
  readonly auth?: ProfileAuth;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Renderer-safe projection. Never contains the API key — callers that need
 * the secret (model execution, connection tests) resolve it server-side.
 */
export interface ModelProfileView {
  readonly id: string;
  readonly name: string;
  readonly mode: ProfileMode;
  readonly protocol: ProfileProtocol;
  readonly apiKeyMasked: boolean;
  readonly endpoint: string | null;
  readonly model: string | null;
  readonly auth: ProfileAuth;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Upsert payload from the settings form. `id` present → edit, absent → new. */
export interface ModelProfileInput {
  readonly id?: string;
  readonly name?: string;
  readonly mode: ProfileMode;
  readonly protocol?: ProfileProtocol;
  /** Empty on edit means "keep the stored key". */
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly auth?: ProfileAuth;
}

export type ModelProfileErrorCode =
  | "errors.modelProfile.nameRequired"
  | "errors.modelProfile.nameTooLong"
  | "errors.modelProfile.invalidMode"
  | "errors.modelProfile.invalidProtocol"
  | "errors.modelProfile.invalidUrl"
  | "errors.modelProfile.invalidModel"
  | "errors.modelProfile.apiKeyRequired"
  | "errors.modelProfile.apiKeyTooShort"
  | "errors.modelProfile.apiKeyTooLong"
  | "errors.modelProfile.notFound"
  | "errors.modelProfile.testFailed"
  | "errors.modelProfile.testTimeout"
  | "errors.modelProfile.listFailed";

export type ModelProfileValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly errorCode: ModelProfileErrorCode };

export interface ModelProfileTestResult {
  readonly ok: boolean;
  readonly latencyMs?: number;
  readonly errorCode?: ModelProfileErrorCode;
}

/**
 * Result of a "list remote models" request. `source: "remote"` means the list
 * came from the provider's `/models` endpoint; `source: "fallback"` means the
 * request failed and a known provider default list was returned instead.
 */
export interface ModelListResult {
  readonly ok: boolean;
  readonly models?: readonly string[];
  readonly source?: "remote" | "fallback";
  readonly message?: string;
  readonly errorCode?: ModelProfileErrorCode;
}

/** Effective protocol for a profile (official is fixed to OpenAI-compatible). */
export function effectiveProtocol(
  mode: ProfileMode,
  protocol?: ProfileProtocol,
): ProfileProtocol {
  return mode === "official" ? OFFICIAL_PROTOCOL : (protocol ?? "openai");
}

/** Effective endpoint for a profile (official preset / protocol default). */
export function effectiveEndpoint(profile: {
  readonly mode: ProfileMode;
  readonly protocol?: ProfileProtocol;
  readonly endpoint?: string;
}): string {
  if (profile.mode === "official") return OFFICIAL_ENDPOINT;
  const trimmed = profile.endpoint?.trim();
  return trimmed || protocolMeta[profile.protocol ?? "openai"].endpoint;
}

/** Effective model id for a profile (official preset / stored / undefined). */
export function effectiveModel(profile: {
  readonly mode: ProfileMode;
  readonly protocol?: ProfileProtocol;
  readonly model?: string;
}): string | undefined {
  if (profile.mode === "official") return OFFICIAL_MODEL;
  return profile.model?.trim() || undefined;
}

/** Effective auth scheme (official → Bearer, custom → stored or protocol default). */
export function effectiveAuth(profile: {
  readonly mode: ProfileMode;
  readonly protocol?: ProfileProtocol;
  readonly auth?: ProfileAuth;
}): ProfileAuth {
  return profile.mode === "official"
    ? "bearer"
    : (profile.auth ?? defaultAuth(profile.protocol ?? "openai"));
}

function validUrl(value: string): boolean {
  if (value.length > PROFILE_ENDPOINT_MAX) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    !url.username &&
    !url.password
  );
}

function validKey(value: string): boolean {
  return (
    value.length >= PROFILE_API_KEY_MIN &&
    value.length <= PROFILE_API_KEY_MAX &&
    !/[\r\n]/.test(value)
  );
}

/**
 * Validate a form payload. Official profiles use the managed preset for all
 * non-secret configuration. The repository additionally checks that an
 * official profile has a stored key before activating it. For edits, an empty
 * key means "keep the stored secret" (the key is never echoed back).
 */
export function validateModelProfileInput(
  input: ModelProfileInput,
  isUpdate = false,
): ModelProfileValidation {
  if (input.mode !== "official" && input.mode !== "custom")
    return { ok: false, errorCode: "errors.modelProfile.invalidMode" };

  const name = input.name?.trim() ?? "";
  if (input.mode === "custom" && name.length === 0)
    return { ok: false, errorCode: "errors.modelProfile.nameRequired" };
  if (name.length > PROFILE_NAME_MAX)
    return { ok: false, errorCode: "errors.modelProfile.nameTooLong" };

  if (input.mode === "custom") {
    if (input.protocol !== "openai" && input.protocol !== "anthropic")
      return { ok: false, errorCode: "errors.modelProfile.invalidProtocol" };

    const endpoint = input.endpoint?.trim();
    if (endpoint && !validUrl(endpoint))
      return { ok: false, errorCode: "errors.modelProfile.invalidUrl" };

    const model = input.model?.trim();
    if (!model)
      return { ok: false, errorCode: "errors.modelProfile.invalidModel" };
    if (!MODEL_ID_PATTERN.test(model))
      return { ok: false, errorCode: "errors.modelProfile.invalidModel" };
  }

  const apiKey = input.apiKey?.trim() ?? "";
  if (input.mode === "custom" && !isUpdate && apiKey.length === 0)
    return { ok: false, errorCode: "errors.modelProfile.apiKeyRequired" };
  if (apiKey.length > 0 && !validKey(apiKey))
    return apiKey.length < PROFILE_API_KEY_MIN
      ? { ok: false, errorCode: "errors.modelProfile.apiKeyTooShort" }
      : { ok: false, errorCode: "errors.modelProfile.apiKeyTooLong" };

  return { ok: true };
}

/** Renderer-safe projection of a stored profile (never includes the key). */
export function toModelProfileView(profile: ModelProfile): ModelProfileView {
  return {
    id: profile.id,
    name: profile.name,
    mode: profile.mode,
    protocol: effectiveProtocol(profile.mode, profile.protocol),
    apiKeyMasked: Boolean(profile.apiKey && profile.apiKey.length > 0),
    endpoint: effectiveEndpoint(profile),
    model: effectiveModel(profile) ?? null,
    auth: effectiveAuth(profile),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
