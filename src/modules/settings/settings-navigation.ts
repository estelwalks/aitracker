export const SETTINGS_CATEGORIES = [
  "preferences",
  "scan",
  "reports",
  "model",
  "data",
  "about",
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export type SettingsSection = "scan" | "reports" | "model" | "menu-bar-app";

export function parseSettingsSection(
  value: unknown,
): SettingsSection | undefined {
  return value === "scan" ||
    value === "reports" ||
    value === "model" ||
    value === "menu-bar-app"
    ? value
    : undefined;
}

export function resolveSettingsCategory(
  section: SettingsSection | undefined,
): SettingsCategory {
  // `menu-bar-app` was a standalone category in older builds. Keep the
  // deep-link working while placing its sole preference with the other app
  // preferences.
  return section === "menu-bar-app"
    ? "preferences"
    : (section ?? "preferences");
}
