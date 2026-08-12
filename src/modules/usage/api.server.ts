import type { TrackerReadModel, UsageModuleContract } from "./contracts.ts";
import type { LocalUsageEvent } from "../../lib/local-usage/types.ts";

export type UsageApiResponse = UsageModuleContract;

/**
 * Load the Token burn leaderboard read model. Runs server-side so the full
 * event set is aggregated into compact, ranked boards before anything reaches
 * the renderer — no raw event arrays cross this boundary.
 */
export async function loadTrackerReadModel(): Promise<TrackerReadModel> {
  const { getLocalUsageSnapshot } =
    await import("../../lib/local-usage/get-local-usage.ts");
  const { createEmptyUsageSnapshot } =
    await import("../../lib/local-usage/presentation.ts");
  const { buildBoard, aggregateBoards } =
    await import("./application/tracker.ts");
  const snapshot = await getLocalUsageSnapshot().then(
    (value) => value,
    () => createEmptyUsageSnapshot(),
  );
  const events: readonly LocalUsageEvent[] = snapshot.details ?? [];
  const boards = {
    skill: buildBoard(events, "skill"),
    project: buildBoard(events, "project"),
    session: buildBoard(events, "session"),
  };
  const totals = aggregateBoards([
    boards.skill,
    boards.project,
    boards.session,
  ]);
  return {
    generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
    boards,
    totals,
  };
}
