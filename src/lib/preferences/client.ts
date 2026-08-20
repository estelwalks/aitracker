import type { PreferenceValue } from "./server-fns.ts";

export async function listPreferences(): Promise<
  Record<string, PreferenceValue>
> {
  const { listAppPreferences } = await import("./server-fns.ts");
  return listAppPreferences();
}

export async function getPreference(
  key: string,
): Promise<PreferenceValue | undefined> {
  const { getAppPreference } = await import("./server-fns.ts");
  return getAppPreference({ data: { key } });
}

export async function setPreference(
  key: string,
  value: PreferenceValue,
): Promise<void> {
  const { setAppPreference } = await import("./server-fns.ts");
  await setAppPreference({ data: { key, value } });
}

export async function removePreference(key: string): Promise<boolean> {
  const { removeAppPreference } = await import("./server-fns.ts");
  return removeAppPreference({ data: { key } });
}

export type { PreferenceValue };
