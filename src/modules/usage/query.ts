import { createServerFn } from "@tanstack/react-start";

import type { TrackerReadModel } from "./contracts.ts";

const PROJECT_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export { TrackerPage } from "./presentation/TrackerPage.tsx";

/**
 * Browser-safe RPC for the Token burn leaderboard.
 *
 * Route loaders run both during SSR and later client-side navigations. A
 * plain dynamic import would execute `api.server.ts` in the browser after the
 * router's stale window elapsed, where local SQLite is unavailable; that
 * failure was swallowed as an empty board. A Server Function keeps every read
 * in the Node runtime while the renderer receives only its compact projection.
 */
export const getTrackerQuery = createServerFn({ method: "GET" }).handler(
  async (): Promise<TrackerReadModel> => {
    const { loadTrackerReadModel } = await import("./api.server.ts");
    return loadTrackerReadModel();
  },
);

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
