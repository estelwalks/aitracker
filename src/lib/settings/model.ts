export interface AppSettings {
  launchAtLoginRequested: boolean;
  retentionDays: number;
  dataPath: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  launchAtLoginRequested: false,
  retentionDays: 90,
  dataPath: "~/.aitracker",
};

export function parseSettings(raw: string | null): AppSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const value = JSON.parse(raw) as Partial<AppSettings>;
    const numberValue = (candidate: unknown, fallback: number) =>
      typeof candidate === "number" &&
      Number.isFinite(candidate) &&
      candidate >= 0
        ? candidate
        : fallback;
    const dataPath =
      typeof value.dataPath === "string" && value.dataPath.length > 0
        ? value.dataPath
        : DEFAULT_SETTINGS.dataPath;
    return {
      ...DEFAULT_SETTINGS,
      launchAtLoginRequested:
        typeof value.launchAtLoginRequested === "boolean"
          ? value.launchAtLoginRequested
          : DEFAULT_SETTINGS.launchAtLoginRequested,
      retentionDays: numberValue(
        value.retentionDays,
        DEFAULT_SETTINGS.retentionDays,
      ),
      // `~/` was the old, incomplete default. Migrate it on read so existing
      // installations display the actual app-owned data root as well.
      dataPath: dataPath === "~/" ? DEFAULT_SETTINGS.dataPath : dataPath,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
