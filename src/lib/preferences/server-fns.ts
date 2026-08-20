import { createServerFn } from "@tanstack/react-start";

import type { PreferenceValue } from "../../modules/settings/infrastructure/sqlite-preference-repository.server.ts";

function validateKey(value: unknown): { key: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { key?: unknown }).key !== "string" ||
    (value as { key: string }).key.length === 0
  ) {
    throw new TypeError("A non-empty preference key is required");
  }
  return value as { key: string };
}

function validateWrite(value: unknown): {
  key: string;
  value: PreferenceValue;
} {
  const key = validateKey(value).key;
  if (!("value" in (value as object))) {
    throw new TypeError("A preference value is required");
  }
  return { key, value: (value as { value: PreferenceValue }).value };
}

async function repository() {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return (await getCompositionRoot()).database.features.appPreferences;
}

export const listAppPreferences = createServerFn({ method: "GET" }).handler(
  async (): Promise<Record<string, PreferenceValue>> => {
    const entries = (await repository()).list();
    return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
  },
);

export const getAppPreference = createServerFn({ method: "POST" })
  .validator(validateKey)
  .handler(async ({ data }): Promise<PreferenceValue | undefined> => {
    return (await repository()).get(data.key)?.value;
  });

export const setAppPreference = createServerFn({ method: "POST" })
  .validator(validateWrite)
  .handler(async ({ data }): Promise<void> => {
    (await repository()).set({
      key: data.key,
      value: data.value,
      updatedAtMs: Date.now(),
    });
  });

export const removeAppPreference = createServerFn({ method: "POST" })
  .validator(validateKey)
  .handler(async ({ data }): Promise<boolean> => {
    return (await repository()).remove(data.key);
  });

export type { PreferenceValue };
