import { createServerFn } from "@tanstack/react-start";

import {
  SECURITY_LLM_REVIEW_PREF_KEY,
  SECURITY_LLM_DIMENSIONS,
  securityLlmDimensionOfRiskKind,
  type SecurityLlmDimension,
  type SecurityLlmReviewAggregateRequest,
  type SecurityLlmReviewAvailability,
  type SecurityLlmReviewRequest,
  type SecurityLlmReviewResult,
} from "./llm-review.contracts";
import { STORAGE_KEY_PREFIX } from "../../lib/app-config";
import type {
  SecurityRiskKind,
  SecuritySeverity,
} from "./presentation/security-view";

const OPAQUE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SECURITY_HISTORY_KEY = `${STORAGE_KEY_PREFIX}security.desktop-history.v1`;

export function parseSecurityLlmReviewRequest(
  value: unknown,
): SecurityLlmReviewRequest {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid security LLM review request");
  }
  const input = value as { historyEntryId?: unknown };
  if (
    typeof input.historyEntryId !== "string" ||
    !OPAQUE_ASSET.test(input.historyEntryId)
  ) {
    throw new TypeError("Invalid history entry reference");
  }
  return { historyEntryId: input.historyEntryId };
}

const RISK_KINDS: readonly SecurityRiskKind[] = [
  "remote_execution",
  "command_injection",
  "data_exfiltration",
  "secret_access",
  "persistence",
  "destructive",
  "obfuscation",
  "privilege_escalation",
  "sensitive_file_access",
  "network_abuse",
  "prompt_injection",
];

/** Rebuild the provider aggregate exclusively from persisted, server-owned history. */
export function resolveSecurityLlmReviewRequestFromHistory(
  historyEntryId: string,
  storedHistory: unknown,
): SecurityLlmReviewAggregateRequest | null {
  if (!Array.isArray(storedHistory)) return null;
  const entry = storedHistory.find(
    (value) =>
      value != null &&
      typeof value === "object" &&
      (value as Record<string, unknown>).id === historyEntryId,
  ) as Record<string, unknown> | undefined;
  const report = entry?.report;
  if (report == null || typeof report !== "object" || Array.isArray(report)) {
    return null;
  }
  const value = report as Record<string, unknown>;
  const verdictMap = {
    allow: "clean",
    warn: "suspicious",
    block: "dangerous",
    unknown: "unknown",
  } as const;
  if (!(String(value.verdict) in verdictMap)) return null;
  const rulesVersion = String(value.rulesVersion ?? "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(rulesVersion)) return null;

  const dimensions = Object.fromEntries(
    SECURITY_LLM_DIMENSIONS.map((dimension) => [
      dimension,
      { hit: false, count: 0 },
    ]),
  ) as Record<SecurityLlmDimension, { hit: boolean; count: number }>;
  const severityCounts = { high: 0, medium: 0, low: 0 };
  const categories =
    value.categories != null &&
    typeof value.categories === "object" &&
    !Array.isArray(value.categories)
      ? (value.categories as Record<string, unknown>)
      : {};
  for (const kind of RISK_KINDS) {
    const category = categories[kind];
    if (
      category == null ||
      typeof category !== "object" ||
      Array.isArray(category)
    ) {
      continue;
    }
    const row = category as Record<string, unknown>;
    const count = Number(row.count);
    if (!Number.isSafeInteger(count) || count < 0 || count > 1_000_000)
      return null;
    const dimension = securityLlmDimensionOfRiskKind(kind);
    dimensions[dimension] = { hit: count > 0, count };
    const severity = String(row.highestSeverity) as SecuritySeverity;
    if (severity === "critical" || severity === "high")
      severityCounts.high += count;
    else if (severity === "medium") severityCounts.medium += count;
    else if (severity === "low") severityCounts.low += count;
    else if (count > 0) return null;
  }
  return {
    assetRef: String(value.contentHash || historyEntryId).slice(0, 128),
    aggregate: {
      dimensions,
      severityCounts,
      verdict: verdictMap[String(value.verdict) as keyof typeof verdictMap],
      assetKind: "skill",
      rulesVersion,
    },
  };
}

/**
 * Explicit, user-triggered LLM review (POST only). This is the sole
 * browser-reachable path that may invoke a model; loaders never call it.
 * Returns a read-only supplement or a typed, degraded status — it never throws
 * on model failure and never alters the static verdict.
 */
export const getSecurityLlmReview = createServerFn({ method: "POST" })
  .validator(parseSecurityLlmReviewRequest)
  .handler(async ({ data }): Promise<SecurityLlmReviewResult> => {
    const { getSecurityLlmReviewService } =
      await import("./application/llm-review.server.ts");
    const service = getSecurityLlmReviewService();
    const availability = await service.availability();
    if (!availability.configured) {
      return { status: "not-configured", review: null };
    }
    if (!availability.enabled) {
      return { status: "disabled", review: null };
    }
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const history =
      root.database.features.appPreferences.get(SECURITY_HISTORY_KEY)?.value;
    const request = resolveSecurityLlmReviewRequestFromHistory(
      data.historyEntryId,
      history,
    );
    if (!request) return { status: "degraded", review: null };
    const review = await service.review(request);
    return review
      ? { status: "reviewed", review }
      : { status: "degraded", review: null };
  });

/** Read-only availability check (no provider call). */
export const getSecurityLlmReviewAvailability = createServerFn({
  method: "GET",
}).handler(async (): Promise<SecurityLlmReviewAvailability> => {
  const { getSecurityLlmReviewService } =
    await import("./application/llm-review.server.ts");
  return getSecurityLlmReviewService().availability();
});

function parseEnabled(value: unknown): { enabled: boolean } {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { enabled?: unknown }).enabled !== "boolean"
  ) {
    throw new TypeError("enabled must be a boolean");
  }
  return { enabled: (value as { enabled: boolean }).enabled };
}

/** Global toggle for the optional LLM review supplement. */
export const setSecurityLlmReviewEnabled = createServerFn({ method: "POST" })
  .validator(parseEnabled)
  .handler(async ({ data }): Promise<SecurityLlmReviewAvailability> => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    root.database.features.appPreferences.set({
      key: SECURITY_LLM_REVIEW_PREF_KEY,
      value: data.enabled,
      updatedAtMs: Date.now(),
    });
    const { getSecurityLlmReviewService } =
      await import("./application/llm-review.server.ts");
    return getSecurityLlmReviewService().availability();
  });
