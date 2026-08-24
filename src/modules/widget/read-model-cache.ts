import type { Locale } from "../../lib/i18n/locale";
import type { WidgetReadModel } from "./read-model";

const STORAGE_KEY = "tt-widget-read-model";

interface CachedWidgetReadModel {
  readonly locale: Locale;
  readonly model: WidgetReadModel;
}

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Read the last compact summary shared by the main and floating windows. */
export function readCachedWidgetReadModel(
  locale: Locale,
): WidgetReadModel | undefined {
  const value = storage()?.getItem(STORAGE_KEY);
  if (value == null) return undefined;
  try {
    const cached = JSON.parse(value) as CachedWidgetReadModel;
    return cached.locale === locale ? cached.model : undefined;
  } catch {
    return undefined;
  }
}

/** Persist only the renderer-safe compact projection, never raw events. */
export function writeCachedWidgetReadModel(
  locale: Locale,
  model: WidgetReadModel,
): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ locale, model }));
  } catch {
    // A disabled/quota-limited browser cache must not affect widget rendering.
  }
}

export function __resetWidgetReadModelCacheForTest(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // Test cleanup is best effort for restricted storage implementations.
  }
}
