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

const WINDOWS_SIZE_SCALE = 0.75;

/** Keeps the existing macOS dimensions and reduces Windows by one quarter. */
export function resolveMainWindowSize(
  platform: NodeJS.Platform = process.platform,
): MainWindowSize {
  if (platform !== "win32") return DEFAULT_MAIN_WINDOW_SIZE;

  return {
    width: Math.round(DEFAULT_MAIN_WINDOW_SIZE.width * WINDOWS_SIZE_SCALE),
    height: Math.round(DEFAULT_MAIN_WINDOW_SIZE.height * WINDOWS_SIZE_SCALE),
    minWidth: Math.round(
      DEFAULT_MAIN_WINDOW_SIZE.minWidth * WINDOWS_SIZE_SCALE,
    ),
    minHeight: Math.round(
      DEFAULT_MAIN_WINDOW_SIZE.minHeight * WINDOWS_SIZE_SCALE,
    ),
  };
}
