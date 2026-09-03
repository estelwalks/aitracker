/**
 * Server functions for the page-insights dual mode (M3).
 *
 * GET `getPageInsight` / POST `enhancePageInsight` are the only browser-reachable
 * paths into the page-insights application; POST `setInsightPreferences` writes
 * the renderer-safe preference projection. All validators whitelist the surface
 * id, locale, scope and reason before any read-model / application work.
 *
 * Responses are renderer-safe by construction: `InsightEnvelope` and the
 * preference projection contain no prompt, key, endpoint, cache key, cost
 * detail or raw error.
 */
import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../../../lib/errors.ts";
import { LOCALES, type Locale } from "../../../lib/i18n/locale.ts";
import {
  INSIGHT_SURFACE_IDS,
  INSIGHT_LAST_LOCALE_PREFERENCE_KEY,
  type InsightEnvelope,
  type InsightMode,
  type InsightPreference,
  type InsightScope,
  type InsightSurfaceId,
  INSIGHT_AUTO_CONSENT_VERSION,
  MAX_INSIGHT_REFRESH_INTERVAL_MS,
  MIN_INSIGHT_REFRESH_INTERVAL_MS,
} from "./contracts.ts";

const ENTITY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const INSIGHT_MODES: readonly InsightMode[] = [
  "rules",
  "enhanced-manual",
  "enhanced-auto",
] as const;

export interface GetPageInsightInput {
  readonly surfaceId: InsightSurfaceId;
  readonly locale: Locale;
  readonly scope: InsightScope;
}

export interface EnhancePageInsightInput extends GetPageInsightInput {
  readonly reason: "manual" | "auto";
}

export interface SetInsightPreferencesInput {
  readonly mode?: InsightMode;
  readonly profileId?: string | null;
  readonly consentVersion?: string | null;
  readonly dailyCallLimit?: number | null;
  readonly refreshIntervalMs?: number;
  readonly surfaceId?: InsightSurfaceId;
}

/** Renderer-safe projection of the persisted insight preference. */
export interface InsightPreferenceView {
  readonly scopeKey: string;
  readonly mode: InsightMode;
  readonly profileId: string | null;
  readonly consentVersion: string | null;
  readonly dailyCallLimit: number | null;
  readonly refreshIntervalMs: number;
}

export interface GetInsightPreferencesInput {
  readonly surfaceId?: InsightSurfaceId;
}

export interface RefreshPageInsightSurfaceInput {
  readonly surfaceId: InsightSurfaceId;
}

export interface RefreshPageInsightsInput {
  readonly locale: Locale;
}

export interface GetPageInsightRefreshStatusInput {
  readonly runId: string;
}

function rememberInsightLocale(
  root: Awaited<
    ReturnType<
      (typeof import("../../../app/composition.server.ts"))["getCompositionRoot"]
    >
  >,
  locale: Locale,
): void {
  try {
    const preferences = root.database.features.appPreferences;
    if (preferences.get(INSIGHT_LAST_LOCALE_PREFERENCE_KEY)?.value === locale)
      return;
    preferences.set({
      key: INSIGHT_LAST_LOCALE_PREFERENCE_KEY,
      value: locale,
      updatedAtMs: Date.now(),
    });
  } catch {
    // Locale memory is an optimization for the background task; a preference
    // write failure must never break the insight read/enhance path.
  }
}

function parseRefreshPageInsightsInput(
  input: unknown,
): RefreshPageInsightsInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const locale = (input as Record<string, unknown>).locale;
  if (!(LOCALES as readonly unknown[]).includes(locale)) {
    throw new AppError("errors.generic");
  }
  return { locale: locale as Locale };
}

function parseGetPageInsightRefreshStatusInput(
  input: unknown,
): GetPageInsightRefreshStatusInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const runId = (input as Record<string, unknown>).runId;
  if (typeof runId !== "string" || !ENTITY_ID_PATTERN.test(runId)) {
    throw new AppError("errors.generic");
  }
  return { runId };
}

export function parseGetInsightPreferencesInput(
  input: unknown,
): GetInsightPreferencesInput {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const surfaceId = (input as Record<string, unknown>).surfaceId;
  if (surfaceId !== undefined && !isSurfaceId(surfaceId)) {
    throw new AppError("errors.generic");
  }
  return surfaceId === undefined ? {} : { surfaceId };
}

function isSurfaceId(value: unknown): value is InsightSurfaceId {
  return (
    typeof value === "string" &&
    (INSIGHT_SURFACE_IDS as readonly string[]).includes(value)
  );
}

export function parseRefreshPageInsightSurfaceInput(
  input: unknown,
): RefreshPageInsightSurfaceInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const surfaceId = (input as Record<string, unknown>).surfaceId;
  if (!isSurfaceId(surfaceId)) throw new AppError("errors.generic");
  return { surfaceId };
}

function parseScope(raw: unknown): InsightScope {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new AppError("errors.generic");
  }
  const record = raw as Record<string, unknown>;
  const scope: { range?: InsightScope["range"]; entityId?: string } = {};
  if (record.range !== undefined) {
    if (
      record.range !== "today" &&
      record.range !== "7d" &&
      record.range !== "30d" &&
      record.range !== "all"
    ) {
      throw new AppError("errors.generic");
    }
    scope.range = record.range;
  }
  if (record.entityId !== undefined) {
    if (
      typeof record.entityId !== "string" ||
      !ENTITY_ID_PATTERN.test(record.entityId)
    ) {
      throw new AppError("errors.generic");
    }
    scope.entityId = record.entityId;
  }
  return scope;
}

/** Exported for unit tests; whitelists surface id, locale and scope. */
export function parseGetPageInsightInput(input: unknown): GetPageInsightInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const value = input as Record<string, unknown>;
  if (
    !isSurfaceId(value.surfaceId) ||
    !(LOCALES as readonly string[]).includes(String(value.locale))
  ) {
    throw new AppError("errors.generic");
  }
  return {
    surfaceId: value.surfaceId,
    locale: value.locale as Locale,
    scope: parseScope(value.scope),
  };
}

/** Exported for unit tests. */
export function parseEnhancePageInsightInput(
  input: unknown,
): EnhancePageInsightInput {
  const base = parseGetPageInsightInput(input);
  const value = input as Record<string, unknown>;
  if (value.reason !== "manual" && value.reason !== "auto") {
    throw new AppError("errors.generic");
  }
  return { ...base, reason: value.reason };
}

/** Exported for unit tests. */
export function parseSetInsightPreferencesInput(
  input: unknown,
): SetInsightPreferencesInput {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new AppError("errors.generic");
  }
  const value = input as Record<string, unknown>;

  const mode =
    value.mode === undefined
      ? "rules"
      : (INSIGHT_MODES as readonly string[]).includes(String(value.mode))
        ? (value.mode as InsightMode)
        : null;
  if (mode == null) throw new AppError("errors.generic");

  const profileId =
    value.profileId === undefined || value.profileId === null
      ? null
      : typeof value.profileId === "string"
        ? value.profileId
        : null;
  if (
    value.profileId !== undefined &&
    value.profileId !== null &&
    profileId === null
  ) {
    throw new AppError("errors.generic");
  }

  const consentVersion =
    value.consentVersion === undefined || value.consentVersion === null
      ? null
      : typeof value.consentVersion === "string"
        ? value.consentVersion
        : null;
  if (
    value.consentVersion !== undefined &&
    value.consentVersion !== null &&
    consentVersion === null
  ) {
    throw new AppError("errors.generic");
  }

  const dailyCallLimit =
    value.dailyCallLimit === undefined || value.dailyCallLimit === null
      ? null
      : typeof value.dailyCallLimit === "number" &&
          Number.isInteger(value.dailyCallLimit) &&
          value.dailyCallLimit >= 0
        ? value.dailyCallLimit
        : null;
  if (
    value.dailyCallLimit !== undefined &&
    value.dailyCallLimit !== null &&
    dailyCallLimit === null
  ) {
    throw new AppError("errors.generic");
  }

  const refreshIntervalMs =
    value.refreshIntervalMs === undefined
      ? undefined
      : typeof value.refreshIntervalMs === "number" &&
          Number.isSafeInteger(value.refreshIntervalMs) &&
          value.refreshIntervalMs >= MIN_INSIGHT_REFRESH_INTERVAL_MS &&
          value.refreshIntervalMs <= MAX_INSIGHT_REFRESH_INTERVAL_MS
        ? value.refreshIntervalMs
        : null;
  if (refreshIntervalMs === null) throw new AppError("errors.generic");

  if (value.surfaceId !== undefined && !isSurfaceId(value.surfaceId)) {
    throw new AppError("errors.generic");
  }
  const surfaceId = value.surfaceId as InsightSurfaceId | undefined;

  return {
    mode,
    profileId,
    consentVersion,
    dailyCallLimit,
    refreshIntervalMs,
    surfaceId,
  };
}

export const getPageInsight = createServerFn({ method: "GET" })
  .validator((input: unknown): GetPageInsightInput =>
    parseGetPageInsightInput(input),
  )
  .handler(async ({ data }): Promise<InsightEnvelope> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const root = await getCompositionRoot();
    // The background task has no renderer request from which to infer the
    // active language. Remember the last requested locale as a safe, local
    // preference so a hidden app can refresh the same language.
    rememberInsightLocale(root, data.locale);
    const envelope = await root.insights.read(
      data.surfaceId,
      data.scope,
      data.locale,
    );
    return envelope;
  });

export const enhancePageInsight = createServerFn({ method: "POST" })
  .validator((input: unknown): EnhancePageInsightInput =>
    parseEnhancePageInsightInput(input),
  )
  .handler(async ({ data }): Promise<InsightEnvelope> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const root = await getCompositionRoot();
    rememberInsightLocale(root, data.locale);
    return root.insights.enhance(data.surfaceId, data.scope, {
      locale: data.locale,
      reason: data.reason,
    });
  });

/** Renderer-safe preference read; never returns a secret or provider endpoint. */
export const getInsightPreferences = createServerFn({ method: "GET" })
  .validator(parseGetInsightPreferencesInput)
  .handler(async ({ data }): Promise<InsightPreferenceView> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const preference = root.database.features.insights.getEffectivePreference(
      data.surfaceId ?? "settings",
    );
    return {
      scopeKey: preference.scopeKey,
      mode: preference.mode,
      profileId: preference.profileId,
      consentVersion: preference.consentVersion,
      dailyCallLimit: preference.dailyCallLimit,
      refreshIntervalMs: root.database.features.insights.getRefreshIntervalMs(),
    };
  });

export const refreshPageInsights = createServerFn({ method: "POST" })
  .validator(parseRefreshPageInsightsInput)
  .handler(async ({ data }) => {
    const { startPageInsightRefreshBatch } =
      await import("./background-refresh.server.ts");
    const result = await startPageInsightRefreshBatch(data.locale);
    return { created: result.created, ...result.run };
  });

export const getPageInsightRefreshStatus = createServerFn({ method: "GET" })
  .validator(parseGetPageInsightRefreshStatusInput)
  .handler(async ({ data }) => {
    const { getPageInsightRefreshBatch } =
      await import("./background-refresh.server.ts");
    const run = await getPageInsightRefreshBatch(data.runId);
    if (!run) throw new AppError("errors.generic");
    return run;
  });

/** Invalidates one surface without expiring unrelated page insight caches. */
export const refreshPageInsightSurface = createServerFn({ method: "POST" })
  .validator(parseRefreshPageInsightSurfaceInput)
  .handler(async ({ data }): Promise<{ invalidated: number }> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const store = (await getCompositionRoot()).database.features.insights;
    return { invalidated: store.invalidateSurface?.(data.surfaceId) ?? 0 };
  });

export const setInsightPreferences = createServerFn({ method: "POST" })
  .validator((input: unknown): SetInsightPreferencesInput =>
    parseSetInsightPreferencesInput(input),
  )
  .handler(async ({ data }): Promise<InsightPreferenceView> => {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const store = root.database.features.insights;

    // A supplied profileId must reference an existing profile before it is
    // persisted (renderer-safe list read; never the key-bearing accessor).
    const profileId: string | null = data.profileId ?? null;
    if (profileId != null) {
      const views = await root.modelProfiles.listViews();
      if (!views.some((view) => view.id === profileId)) {
        throw new AppError("errors.modelProfile.notFound");
      }
    }

    const scopeKey = data.surfaceId ? `surface:${data.surfaceId}` : "global";
    const mode = data.mode ?? "rules";
    if (
      mode === "enhanced-auto" &&
      data.consentVersion !== INSIGHT_AUTO_CONSENT_VERSION
    ) {
      throw new AppError("errors.generic");
    }
    const consentVersion =
      mode === "enhanced-auto" ? INSIGHT_AUTO_CONSENT_VERSION : null;
    const nowMs = Date.now();
    const refreshIntervalMs =
      data.refreshIntervalMs ?? store.getRefreshIntervalMs();
    if (data.refreshIntervalMs !== undefined) {
      store.setRefreshIntervalMs(refreshIntervalMs, nowMs);
      store.invalidateAll?.();
    }
    const preference: InsightPreference = {
      scopeKey,
      mode,
      profileId,
      consentVersion,
      consentedAtMs: consentVersion != null ? nowMs : null,
      dailyCallLimit: data.dailyCallLimit ?? null,
      updatedAtMs: nowMs,
    };
    store.setPreference(preference);

    return {
      scopeKey,
      mode: preference.mode,
      profileId,
      consentVersion,
      dailyCallLimit: preference.dailyCallLimit,
      refreshIntervalMs,
    };
  });
