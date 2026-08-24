export const SETTINGS_CATEGORIES = [
  "general",
  "scan",
  "model",
  "menuBarApp",
  "appearance",
  "about",
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
export type SettingsSection = "scan" | "model" | "menu-bar-app";

export function parseSettingsSection(
  value: unknown,
): SettingsSection | undefined {
  return value === "scan" || value === "model" || value === "menu-bar-app"
    ? value
    : undefined;
}

export function resolveSettingsCategory(
  section: SettingsSection | undefined,
): SettingsCategory {
  return section === "menu-bar-app" ? "menuBarApp" : (section ?? "general");
}
