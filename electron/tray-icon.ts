import { existsSync } from "node:fs";
import { join } from "node:path";

export const TRAY_ICON_FILENAME = "ai-tracker-icon-app.png";

/**
 * Small PNG fallback for the exceptional case where the external logo cannot
 * be read. The packaged application normally always resolves the real logo.
 */
export const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAABcRAAAXEQHKJvM/AAAABGdBTUEAALGPC/xhBQAAAAlwSFlzAAALEwAACxMBAJqcGAAAAM5JREFUOE+lkzEOwjAMRK9SFgYGYkNIDM0H8AEcAU1HSEh0h9gYGBgYqQKiY3EoI8Oh0qQ3mX7b/34KQgAAgO8qyzL0fV9jv0IY6tL3fQ4hhI6iKJxS8jzvK4qioKqq6vu+53neY6qq8jzPdd2H4biu6/KcZVmGYRj2fR+GYVhjzP2mA2SxWKyCIEhTFEV5ntf3fbHc4jgGQRAcWZZlPB6PjDFm27aqqipJkrqu67qu63q9Xq/X6yVJ0lprHcdxPp8v6QdQSwD9eF+K9gAAAABJRU5ErkJggg==";

/**
 * Resolve the supplied application logo for both development and packaged
 * applications. It is kept in extraResources so the asar boundary does not
 * affect native tray loading.
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
    : join(
        input.appPath,
        "public",
        "brand-logos",
        "ai-tracker",
        TRAY_ICON_FILENAME,
      );
  return fileExists(candidate) ? candidate : null;
}
