/**
 * Main-window geometry: a persistable rectangle plus the pure rules that put a
 * stored rectangle back on a screen that may have changed since it was saved.
 *
 * Two problems are solved here:
 *
 * 1. The default 1440×940 window does not fit a 1366×768 laptop panel. Every
 *    start re-centred an oversized window on a small Linux display.
 * 2. Nothing in the app remembered where the window was or how big the user
 *    made it, so each launch started from the default rectangle again.
 *
 * `resolveMainWindowSize()` keeps returning the per-platform default for the
 * unchanged cases; `fitBoundsToWorkArea()` is the clamp that makes a stored or
 * default rectangle usable on the display actually present.
 */

export interface MainWindowSize {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

export interface WindowRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface WindowSize {
  readonly width: number;
  readonly height: number;
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

/**
 * Smallest usable frame. `minWidth`/`minHeight` are what the user may resize
 * to; these are the floor for the *initial* rectangle, which also has to fit
 * inside the work area of a small display.
 */
const MINIMUM_FITTED_WIDTH = 960;
const MINIMUM_FITTED_HEIGHT = 640;

/**
 * Per-platform default size, clamped to the work area of the display the
 * window will open on. Without a work area the historical values are returned
 * unchanged, which keeps macOS and Windows byte-for-byte compatible.
 */
export function resolveMainWindowSize(
  platform: NodeJS.Platform = process.platform,
  workArea?: WindowSize,
): MainWindowSize {
  const base =
    platform === "win32" ? WINDOWS_MAIN_WINDOW_SIZE : DEFAULT_MAIN_WINDOW_SIZE;
  if (!workArea) return base;

  const fitted = fitSizeToWorkArea(base, workArea);
  if (fitted.width === base.width && fitted.height === base.height) return base;
  return { ...base, width: fitted.width, height: fitted.height };
}

/** Shrink a requested size until it fits the work area, with a usable floor. */
export function fitSizeToWorkArea(
  requested: WindowSize,
  workArea: WindowSize,
): WindowSize {
  const maxWidth = Math.max(workArea.width, 1);
  const maxHeight = Math.max(workArea.height, 1);
  const width = Number.isFinite(requested.width) ? requested.width : maxWidth;
  const height = Number.isFinite(requested.height)
    ? requested.height
    : maxHeight;
  return {
    width: Math.round(
      Math.max(
        Math.min(width, maxWidth),
        Math.min(MINIMUM_FITTED_WIDTH, maxWidth),
      ),
    ),
    height: Math.round(
      Math.max(
        Math.min(height, maxHeight),
        Math.min(MINIMUM_FITTED_HEIGHT, maxHeight),
      ),
    ),
  };
}

/**
 * Clamp a rectangle so a grabbable part of it is always on screen.
 *
 * A stored position is honoured only while the window still overlaps the work
 * area; a monitor that was unplugged, or a resolution reduction, must not leave
 * the window off-screen. The size is clamped first, then the origin, so the
 * right/bottom edge of a shrunk window stays inside the work area.
 */
export function fitBoundsToWorkArea(
  bounds: WindowRectangle,
  workArea: WindowRectangle,
): WindowRectangle {
  const size = fitSizeToWorkArea(bounds, workArea);
  const fitsHorizontally =
    Number.isFinite(bounds.x) &&
    bounds.x >= workArea.x &&
    bounds.x + size.width <= workArea.x + workArea.width;
  const fitsVertically =
    Number.isFinite(bounds.y) &&
    bounds.y >= workArea.y &&
    bounds.y + size.height <= workArea.y + workArea.height;

  return {
    width: size.width,
    height: size.height,
    x: fitsHorizontally
      ? Math.round(bounds.x)
      : Math.round(
          Math.min(
            Math.max(bounds.x, workArea.x),
            workArea.x + workArea.width - size.width,
          ),
        ),
    y: fitsVertically
      ? Math.round(bounds.y)
      : Math.round(
          Math.min(
            Math.max(bounds.y, workArea.y),
            workArea.y + workArea.height - size.height,
          ),
        ),
  };
}

/**
 * Read a persisted rectangle, rejecting anything that could not have been
 * produced by a real window. Persisted state is untrusted input: a truncated or
 * hand-edited file must fall back to the default rather than create a
 * zero-sized or off-screen window.
 */
export function parseStoredWindowBounds(
  value: unknown,
): WindowRectangle | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"].map((key) => record[key]);
  if (
    !numbers.every(
      (entry) => typeof entry === "number" && Number.isFinite(entry),
    )
  ) {
    return null;
  }
  const [x, y, width, height] = numbers as number[];
  if (width < MINIMUM_FITTED_WIDTH || height < MINIMUM_FITTED_HEIGHT)
    return null;
  return { x, y, width, height };
}

/**
 * The `BrowserWindow` geometry for this launch.
 *
 * A stored rectangle is fitted to the current work area. With nothing stored
 * only the size is returned: omitting the origin lets the window manager place
 * the first-run window (Electron centres it), which is the behaviour macOS and
 * Windows had before geometry was persisted.
 */
export function resolveMainWindowGeometry(input: {
  readonly platform?: NodeJS.Platform;
  readonly stored: WindowRectangle | null;
  readonly workArea: WindowRectangle;
}):
  | (WindowSize & { readonly minWidth: number; readonly minHeight: number })
  | (WindowRectangle & {
      readonly minWidth: number;
      readonly minHeight: number;
    }) {
  const size = resolveMainWindowSize(input.platform, input.workArea);
  if (!input.stored) {
    // `fitSizeToWorkArea` also guards the no-stored-bounds case on a display
    // smaller than the platform default.
    return {
      ...fitSizeToWorkArea(size, input.workArea),
      minWidth: size.minWidth,
      minHeight: size.minHeight,
    };
  }
  const fitted = fitBoundsToWorkArea(input.stored, input.workArea);
  return { ...fitted, minWidth: size.minWidth, minHeight: size.minHeight };
}

export { DEFAULT_MAIN_WINDOW_SIZE, WINDOWS_MAIN_WINDOW_SIZE };
