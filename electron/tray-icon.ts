import { existsSync } from "node:fs";
import { join } from "node:path";

export const TRAY_ICON_FILENAME = "tray-iconTemplate.png";

/** 18×18 monochrome macOS template icon; alpha is recolored by AppKit. */
export const TRAY_ICON_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="#000" d="M9 1.25 15 3.5v4.17c0 3.96-2.37 7.34-6 9.08-3.63-1.74-6-5.12-6-9.08V3.5L9 1.25Zm0 2.08L5 4.83v2.84c0 2.92 1.62 5.5 4 6.98 2.38-1.48 4-4.06 4-6.98V4.83L9 3.33ZM7.9 6.1h2.2v2.15h2.15v2.2H10.1v2.15H7.9v-2.15H5.75v-2.2H7.9V6.1Z"/></svg>',
).toString("base64")}`;

/**
 * Resolve an optional packaged raster without probing a missing development
 * path. The inline SVG remains the portable fallback for dev and packages.
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
    ? join(input.resourcesPath, "web", "public", "build", TRAY_ICON_FILENAME)
    : join(input.appPath, "public", "build", TRAY_ICON_FILENAME);
  return fileExists(candidate) ? candidate : null;
}
