export interface MainWindowSize {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

const DEFAULT_MAIN_WINDOW_SIZE: MainWindowSize = {
  width: 1440,
  height: 940,
  minWidth: 1100,
  minHeight: 720,
};

const WINDOWS_MAIN_WINDOW_SIZE: MainWindowSize = {
  width: 1280,
  height: 800,
  // Keep the reduced minimum from the previous Windows layout.
  minWidth: 891,
  minHeight: 583,
};

/** Keeps macOS unchanged while using a fixed 1280×800 Windows default. */
export function resolveMainWindowSize(
  platform: NodeJS.Platform = process.platform,
): MainWindowSize {
  if (platform !== "win32") return DEFAULT_MAIN_WINDOW_SIZE;

  return WINDOWS_MAIN_WINDOW_SIZE;
}
