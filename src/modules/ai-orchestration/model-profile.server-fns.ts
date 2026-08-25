/**
 * Model profile server functions (S-500). Renderer-safe facade over the
 * server-only profile store: handlers resolve the shared composition root so
 * no independent persistence path can be constructed, and
 * browser bundle, and every returned projection is key-free (`ModelProfileView`
 * carries only `apiKeyMasked`).
 *
 * Input validation runs twice: the `.validator` rejects malformed payloads
 * with typed AppError codes before any I/O; the repository re-validates as
 * defence-in-depth.
 */
import { createServerFn } from "@tanstack/react-start";

import type { CompositionRoot } from "../../app/composition.server.ts";
import { AppError } from "../../lib/errors.ts";
import type { MessageKey } from "../../lib/i18n/messages.ts";
import {
  PROFILE_API_KEY_MAX,
  PROFILE_API_KEY_MIN,
  PROFILE_ENDPOINT_MAX,
  validateModelProfileInput,
  type ModelListResult,
  type ModelProfileInput,
  type ModelProfileTestResult,
  type ModelProfileView,
} from "./model-profile.ts";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseProfileInput(value: unknown): ModelProfileInput {
  if (value == null || typeof value !== "object")
    throw new AppError("errors.modelProfile.nameRequired");
  const candidate = value as ModelProfileInput;
  if (candidate.mode !== "official" && candidate.mode !== "custom")
    throw new AppError("errors.modelProfile.invalidMode");
  if (candidate.id != null && !OPAQUE_ID.test(candidate.id))
    throw new AppError("errors.modelProfile.notFound");
  const input: ModelProfileInput = {
    mode: candidate.mode,
    ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
    ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
    ...(typeof candidate.protocol === "string"
      ? { protocol: candidate.protocol as ModelProfileInput["protocol"] }
      : {}),
    ...(candidate.auth === "x-api-key" || candidate.auth === "bearer"
      ? { auth: candidate.auth }
      : {}),
    ...(typeof candidate.apiKey === "string"
      ? { apiKey: candidate.apiKey }
      : {}),
    ...(typeof candidate.endpoint === "string"
      ? { endpoint: candidate.endpoint }
      : {}),
    ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
  };
  const validation = validateModelProfileInput(input, input.id != null);
  if (!validation.ok) throw new AppError(validation.errorCode);
  return input;
}

function parseProfileId(value: unknown): { id: string } {
  if (
    value == null ||
    typeof value !== "object" ||
    typeof (value as { id?: unknown }).id !== "string" ||
    !OPAQUE_ID.test((value as { id: string }).id)
  ) {
    throw new AppError("errors.modelProfile.notFound");
  }
  return { id: (value as { id: string }).id };
}

/**
 * Payload for the "list remote models" action. Unlike `parseProfileInput` an
 * apiKey is NOT required: when editing an existing profile the form may leave
 * the key blank and the server merges the stored secret before the request.
 */
export interface ListRemoteModelsInput {
  readonly id?: string;
  readonly mode: "official" | "custom";
  readonly protocol?: "openai" | "anthropic";
  readonly auth?: "x-api-key" | "bearer";
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

function parseListRemoteModelsInput(value: unknown): ListRemoteModelsInput {
  if (value == null || typeof value !== "object")
    throw new AppError("errors.modelProfile.invalidMode");
  const candidate = value as ListRemoteModelsInput;
  if (candidate.mode !== "official" && candidate.mode !== "custom")
    throw new AppError("errors.modelProfile.invalidMode");
  if (candidate.id != null && !OPAQUE_ID.test(candidate.id))
    throw new AppError("errors.modelProfile.notFound");

  const input: ListRemoteModelsInput = {
    mode: candidate.mode,
    ...(typeof candidate.id === "string" ? { id: candidate.id } : {}),
    ...(candidate.protocol === "openai" || candidate.protocol === "anthropic"
      ? { protocol: candidate.protocol }
      : {}),
    ...(candidate.auth === "x-api-key" || candidate.auth === "bearer"
      ? { auth: candidate.auth }
      : {}),
    ...(typeof candidate.apiKey === "string"
      ? { apiKey: candidate.apiKey }
      : {}),
    ...(typeof candidate.endpoint === "string"
      ? { endpoint: candidate.endpoint }
      : {}),
    ...(typeof candidate.model === "string" ? { model: candidate.model } : {}),
  };

  const endpoint = input.endpoint?.trim();
  if (endpoint && !isListUrlValid(endpoint))
    throw new AppError("errors.modelProfile.invalidUrl");

  const apiKey = input.apiKey?.trim() ?? "";
  if (
    apiKey.length > 0 &&
    (apiKey.length < PROFILE_API_KEY_MIN || apiKey.length > PROFILE_API_KEY_MAX)
  ) {
    throw new AppError(
      apiKey.length < PROFILE_API_KEY_MIN
        ? "errors.modelProfile.apiKeyTooShort"
        : "errors.modelProfile.apiKeyTooLong",
    );
  }
  return input;
}

/** http/https without embedded credentials (mirrors model-profile validUrl). */
function isListUrlValid(value: string): boolean {
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

export interface ModelProfileListResult {
  readonly profiles: readonly ModelProfileView[];
  readonly activeProfileId: string | null;
}

/**
 * A model edit changes the meaning of every enhanced insight. Invalidate the
 * old model's cache before the renderer re-reads its cards; the cards then
 * regenerate through the normal AI-insight toggle/consent path.
 */
function invalidateInsightCacheBestEffort(root: CompositionRoot): void {
  try {
    root.database.features.insights.invalidateAll?.();
  } catch {
    // A cache cleanup failure must never make a valid model configuration look
    // like it failed to save. The next page read will still use the new model.
  }
}

/** Renderer-safe profile list + active id (Settings model panel / distill). */
export const listModelProfiles = createServerFn({ method: "GET" }).handler(
  async (): Promise<ModelProfileListResult> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const repository = (await getCompositionRoot()).modelProfiles;
    const [profiles, active] = await Promise.all([
      repository.listViews(),
      repository.getActiveView(),
    ]);
    return { profiles, activeProfileId: active?.id ?? null };
  },
);

/** Create or update a profile; returns the key-free saved projection. */
export const upsertModelProfile = createServerFn({ method: "POST" })
  .validator((input: unknown): ModelProfileInput => parseProfileInput(input))
  .handler(async ({ data }): Promise<ModelProfileView> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    try {
      const root = await getCompositionRoot();
      const activeBefore = await root.modelProfiles.getActiveView();
      const saved = await root.modelProfiles.upsert(data);
      if (activeBefore?.id === saved.id) {
        invalidateInsightCacheBestEffort(root);
      }
      return saved;
    } catch (error) {
      const raw = error as { code?: unknown };
      const code =
        error instanceof Error && typeof raw.code === "string"
          ? raw.code
          : undefined;
      if (code) throw new AppError(code as MessageKey);
      throw error;
    }
  });

export interface ModelProfileActionResult {
  readonly ok: boolean;
  readonly errorCode?: string;
}

/** Delete a profile; deleting the active one activates the first survivor. */
export const deleteModelProfile = createServerFn({ method: "POST" })
  .validator((input: unknown): { id: string } => parseProfileId(input))
  .handler(async ({ data }): Promise<ModelProfileActionResult> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const activeBefore = await root.modelProfiles.getActiveView();
    const result = await root.modelProfiles.remove(data.id);
    if (result.ok && activeBefore?.id === data.id) {
      invalidateInsightCacheBestEffort(root);
    }
    return result;
  });

/** Activate a profile (takes effect immediately for profile-based runs). */
export const setActiveModelProfile = createServerFn({ method: "POST" })
  .validator((input: unknown): { id: string } => parseProfileId(input))
  .handler(async ({ data }): Promise<ModelProfileActionResult> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const result = await root.modelProfiles.setActive(data.id);
    if (result.ok) invalidateInsightCacheBestEffort(root);
    return result;
  });

/**
 * One minimal completion request against the (effective) profile config with a
 * short timeout. On edit with an empty key the stored secret is used; the
 * result never contains the key.
 */
export const testModelProfile = createServerFn({ method: "POST" })
  .validator((input: unknown): ModelProfileInput => parseProfileInput(input))
  .handler(async ({ data }): Promise<ModelProfileTestResult> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    return (await getCompositionRoot()).modelProfiles.test(data);
  });

/**
 * Fetch the remote model list for the (effective) profile config. Blank keys
 * are allowed: on edit the stored secret is merged server-side. When the live
 * request fails, the result contains no model list and a sanitized reason; it
 * never contains the key.
 */
export const listRemoteModels = createServerFn({ method: "POST" })
  .validator((input: unknown): ListRemoteModelsInput =>
    parseListRemoteModelsInput(input),
  )
  .handler(async ({ data }): Promise<ModelListResult> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    return (await getCompositionRoot()).modelProfiles.listModels(data);
  });
