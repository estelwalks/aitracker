/**
 * Usage query transport bridge. Re-exports the tracker page and loads its read
 * model server-side, mirroring the dashboard/sessions query pattern.
 */
import type { TrackerReadModel } from "./contracts.ts";

export { TrackerPage } from "./presentation/TrackerPage.tsx";

/** Resolve the Token burn leaderboard read model on the server. */
export async function getTrackerQuery(): Promise<TrackerReadModel> {
  const { loadTrackerReadModel } = await import("./api.server.ts");
  return loadTrackerReadModel();
}
