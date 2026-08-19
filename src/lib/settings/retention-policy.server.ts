import { STORAGE_KEY_PREFIX } from "../app-config.ts";
import { parseSettings } from "./model.ts";

const SETTINGS_KEY = `${STORAGE_KEY_PREFIX}settings.v1`;

export function retentionDaysFromPreference(value: unknown): number {
  return parseSettings(typeof value === "string" ? value : null).retentionDays;
}

/** Reads the persisted setting from the sole SQLite preference repository. */
export async function readCurrentRetentionDays(): Promise<number> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  return retentionDaysFromPreference(
    root.database.features.appPreferences.get(SETTINGS_KEY)?.value,
  );
}
