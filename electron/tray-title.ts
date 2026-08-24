export interface TrayTitleTarget {
  getTitle(): string;
  setTitle(title: string): void;
}

export const TRAY_TITLE_PREF_KEY = "tt.menuBarTitle";
export const TRAY_TITLE_PLACEHOLDER = "·";

export function normalizeTrayTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.trim().slice(0, 80);
  return title.length > 0 ? title : null;
}

/** Avoid native status-item layout work when another renderer sent the same title. */
export function updateTrayTitleIfChanged(
  tray: TrayTitleTarget,
  title: string,
): boolean {
  if (tray.getTitle() === title) return false;
  tray.setTitle(title);
  return true;
}

/** Persist a last-known title without turning cache failure into UI failure. */
export async function persistTrayTitleBestEffort(
  persist: (title: string) => Promise<void>,
  title: string,
  onError: (error: unknown) => void = () => {},
): Promise<boolean> {
  try {
    await persist(title);
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}

export async function readTrayPreferencesBestEffort(
  read: () => Promise<Record<string, unknown>>,
  onError: (error: unknown) => void = () => {},
): Promise<{
  readonly preferences: Record<string, unknown>;
  readonly title: string;
}> {
  try {
    const preferences = await read();
    return {
      preferences,
      title:
        normalizeTrayTitle(preferences[TRAY_TITLE_PREF_KEY]) ??
        TRAY_TITLE_PLACEHOLDER,
    };
  } catch (error) {
    onError(error);
    return { preferences: {}, title: TRAY_TITLE_PLACEHOLDER };
  }
}
