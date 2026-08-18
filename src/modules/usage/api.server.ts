import type { TrackerReadModel, UsageModuleContract } from "./contracts.ts";
import type { LocalUsageEvent } from "../../lib/local-usage/types.ts";

export type UsageApiResponse = UsageModuleContract;

/**
 * Load the Token burn leaderboard read model. Runs server-side so the full
 * event set is aggregated into compact, ranked boards before anything reaches
 * the renderer — no raw event arrays cross this boundary.
 *
 * T7-08: reads the unified Usage snapshot (O(1), never scans on the query
 * path); an absent snapshot degrades to the empty read model.
 */
export async function loadTrackerReadModel(): Promise<TrackerReadModel> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { createEmptyUsageSnapshot } =
    await import("../../lib/local-usage/presentation.ts");
  const { buildBoard, trackerTotalsFromEvents } =
    await import("./application/tracker.ts");
  const { usageSnapshot } = await getCompositionRoot();
  await usageSnapshot.ensureHydrated();
  const latest = usageSnapshot.readLatest();
  const snapshot = latest.data ?? createEmptyUsageSnapshot();
  const events: readonly LocalUsageEvent[] = snapshot.details ?? [];
  const boards = {
    skill: buildBoard(events, "skill"),
    project: buildBoard(events, "project"),
    session: buildBoard(events, "session"),
  };
  const totals = trackerTotalsFromEvents(events, [
    boards.skill,
    boards.project,
    boards.session,
  ]);
  return {
    // `createEmptyUsageSnapshot` has a construction timestamp, not a scan
    // timestamp. Only expose the generated time for an actual local scan.
    generatedAt: snapshot.mode === "real" ? snapshot.generatedAt : null,
    boards,
    totals,
  };
}
