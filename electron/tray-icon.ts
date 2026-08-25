import { existsSync } from "node:fs";
import { join } from "node:path";

export const TRAY_ICON_FILENAME = "tray-iconTemplate.png";

/**
 * 16×16 opaque-black template PNG encoded inline for the exceptional case
 * where the external asset cannot be read. PNG is deliberately used rather
 * than SVG: AppKit reliably applies the template mask to a NativeImage PNG.
 */
export const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAABcRAAAXEQHKJvM/AAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAM5JREFUOE+lkzEOwjAMRK9SFgYGYkNIDM0H8AEcAU1HSEh0h9gYGBgYqQKiY3EoI8Oh0qQ3mX7b/34KQgAAgO8qyzL0fV9jv0IY6tL3fQ4hhI6iKJxS8jzvK4qioKqq6vu+53neY6qq8jzPdd2H4biu6/KcZVmGYRj2fR+GYVhjzP2mA2SxWKyCIEhTFEV5ntf3fbHc4jgGQRAcWZZlPB6PjDFm27aqqipJkrqu67qu63q9Xq/X6yVJ0lprHcdxPp8v6QdQSwD9eF+K9gAAAABJRU5ErkJggg==";

/**
 * Resolve the matching, adjacent Template image pair. Packaged apps use a
 * dedicated native resource rather than the Vite/Nitro web output, avoiding
 * platform-specific output-copy differences during arm64 packaging.
 */
export function findTrayIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
  },
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  const candidate = input.isPackaged
    ? join(input.resourcesPath, "tray", TRAY_ICON_FILENAME)
    : join(input.appPath, "public", "build", TRAY_ICON_FILENAME);
  return fileExists(candidate) ? candidate : null;
}
