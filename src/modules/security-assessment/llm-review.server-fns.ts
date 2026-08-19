import { createServerFn } from "@tanstack/react-start";

import {
  SECURITY_LLM_REVIEW_PREF_KEY,
  type SecurityLlmReviewAggregate,
  type SecurityLlmReviewAvailability,
  type SecurityLlmReviewRequest,
  type SecurityLlmReviewResult,
} from "./llm-review.contracts";

const OPAQUE_ASSET = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function parseRequest(value: unknown): SecurityLlmReviewRequest {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid security LLM review request");
  }
  const input = value as { assetRef?: unknown; aggregate?: unknown };
  if (
    typeof input.assetRef !== "string" ||
    !OPAQUE_ASSET.test(input.assetRef)
  ) {
    throw new TypeError("Invalid asset reference");
  }
  if (
    input.aggregate == null ||
    typeof input.aggregate !== "object" ||
    Array.isArray(input.aggregate)
  ) {
    throw new TypeError("Invalid aggregate");
  }
  return {
    assetRef: input.assetRef,
    aggregate: input.aggregate as SecurityLlmReviewAggregate,
  };
}

/**
 * Explicit, user-triggered LLM review (POST only). This is the sole
 * browser-reachable path that may invoke a model; loaders never call it.
 * Returns a read-only supplement or a typed, degraded status — it never throws
 * on model failure and never alters the static verdict.
 */
export const getSecurityLlmReview = createServerFn({ method: "POST" })
  .validator(parseRequest)
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
    const review = await service.review(data);
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
