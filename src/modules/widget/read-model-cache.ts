import type { Locale } from "../../lib/i18n/locale";
import {
  getPreference,
  removePreference,
  setPreference,
} from "../../lib/preferences/client.ts";
import type { WidgetReadModel } from "./read-model";

const STORAGE_KEY = "aitracker.widget.read-model";

interface CachedWidgetReadModel {
  readonly locale: Locale;
  readonly model: WidgetReadModel;
}

/** Read the last compact summary shared by the main and floating windows. */
export async function readCachedWidgetReadModel(
  locale: Locale,
): Promise<WidgetReadModel | undefined> {
  if (typeof window === "undefined") return undefined;
  try {
    const value = await getPreference(STORAGE_KEY);
    if (typeof value !== "string") return undefined;
    const cached = JSON.parse(value) as CachedWidgetReadModel;
    return cached.locale === locale ? cached.model : undefined;
  } catch {
    return undefined;
  }
}

/** Persist only the renderer-safe compact projection, never raw events. */
export async function writeCachedWidgetReadModel(
  locale: Locale,
  model: WidgetReadModel,
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await setPreference(STORAGE_KEY, JSON.stringify({ locale, model }));
  } catch {
    // A disabled/quota-limited browser cache must not affect widget rendering.
  }
}

export async function __resetWidgetReadModelCacheForTest(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await removePreference(STORAGE_KEY);
  } catch {
    // Test cleanup is best effort for restricted storage implementations.
  }
}
