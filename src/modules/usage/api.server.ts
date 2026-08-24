import type { TrackerReadModel, UsageModuleContract } from "./contracts.ts";

export type UsageApiResponse = UsageModuleContract;

function emptyTrackerReadModel(): TrackerReadModel {
  const emptyBoard = { rows: [], totalTokens: 0, totalEntries: 0 } as const;
  return {
    generatedAt: null,
    boards: {
      skill: emptyBoard,
      project: emptyBoard,
      session: emptyBoard,
    },
    totals: { tokens: 0, events: 0, entries: 0 },
  };
}

/**
 * Load the Token burn leaderboard read model. Runs server-side so the full
 * event set is aggregated into compact, ranked boards before anything reaches
 * the renderer — no raw event arrays cross this boundary.
 *
 * Reads the persisted aggregate projection with a fixed query count. This is
 * intentionally independent of the coordinator's hot value: the repository
 * has already replaced project/session refs with installation-scoped HMACs.
 */
export async function loadTrackerReadModel(): Promise<TrackerReadModel> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const { buildTrackerReadModelFromProjection } =
      await import("./application/tracker.ts");
    const root = await getCompositionRoot();
    const hydrated = await root.database.features.usageSnapshots.load();
    const snapshot = hydrated.envelope.data;
    if (snapshot == null) return emptyTrackerReadModel();
    return buildTrackerReadModelFromProjection({
      generatedAt: snapshot.mode === "real" ? snapshot.generatedAt : null,
      buckets: snapshot.trackerBuckets ?? [],
    });
  } catch (error) {
    // A broken persisted snapshot or database must not turn this read-only
    // dashboard into a route-level SSR failure. Keep the original error for
    // diagnostics and render a valid empty read model instead.
    console.error(
      "Failed to load tracker read model; serving empty board",
      error,
    );
    return emptyTrackerReadModel();
  }
}
