/**
 * Usage mutation/read server functions. Kept separate from `query.ts` because
 * `query.ts` re-exports the page component; importing these from the page
 * directly (rather than via `query`) avoids a query → page → query import cycle
 * that the architecture verifier blocks. The heavy server work lives in
 * `api.server.ts` / the composition root and is dynamically imported so it
 * never reaches the browser.
 */
import { createServerFn } from "@tanstack/react-start";

const PROJECT_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

/**
 * Persist a user-confirmed project merge. Only opaque HMAC identities cross
 * the server-function boundary; raw filesystem paths never enter this API.
 */
export const mergeProjectIdentitiesQuery = createServerFn({ method: "POST" })
  .validator(
    (
      value: unknown,
    ): {
      sourceIdentity: string;
      targetIdentity: string;
    } => {
      if (value == null || typeof value !== "object") {
        throw new TypeError("project identities are required");
      }
      const candidate = value as Record<string, unknown>;
      const sourceIdentity =
        typeof candidate.sourceIdentity === "string"
          ? candidate.sourceIdentity.trim()
          : "";
      const targetIdentity =
        typeof candidate.targetIdentity === "string"
          ? candidate.targetIdentity.trim()
          : "";
      if (
        !PROJECT_IDENTITY_PATTERN.test(sourceIdentity) ||
        !PROJECT_IDENTITY_PATTERN.test(targetIdentity) ||
        sourceIdentity === targetIdentity
      ) {
        throw new TypeError("invalid project identity merge");
      }
      return { sourceIdentity, targetIdentity };
    },
  )
  .handler(async ({ data }) => {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    root.database.features.projectIdentityMerges.merge(
      data.sourceIdentity,
      data.targetIdentity,
    );
    // Mark both projections stale and request their normal background refresh.
    // Their repositories also resolve the alias while loading, so the merge is
    // visible immediately to direct read-model queries.
    await Promise.all([
      root.usageSnapshot.invalidate(),
      root.sessionSnapshot.invalidate(),
    ]);
    return {
      sourceIdentity: data.sourceIdentity,
      targetIdentity: data.targetIdentity,
    };
  });
