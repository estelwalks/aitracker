import { existsSync } from "node:fs";
import { join } from "node:path";

export type NativeIconAppearance = "light" | "dark";

export const TRAY_ICON_FILENAMES = {
  light: "favicon-light.png",
  dark: "favicon-dark.png",
} as const;

export const WINDOWS_TRAY_ICON_FILENAMES = {
  light: "favicon-light-windows.png",
  dark: "favicon-dark-windows.png",
} as const;

export const APP_ICON_FILENAMES = {
  light: "favicon-light-512.png",
  dark: "favicon-dark-512.png",
} as const;

function findNativeIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
  },
  filename: string,
  fileExists: (path: string) => boolean,
): string | null {
  const candidate = input.isPackaged
    ? join(input.resourcesPath, "native-icons", filename)
    : join(input.appPath, "build", "native-icons", filename);
  return fileExists(candidate) ? candidate : null;
}

/** Resolve the platform-specific 16px tray/menu-bar icon. */
export function findTrayIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
    readonly platform?: NodeJS.Platform;
  },
  appearance: NativeIconAppearance,
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  const filenames =
    input.platform === "win32"
      ? WINDOWS_TRAY_ICON_FILENAMES
      : TRAY_ICON_FILENAMES;
  return findNativeIconPath(input, filenames[appearance], fileExists);
}

/** Resolve the large runtime icon used by the macOS Dock and Windows windows. */
export function findAppIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
  },
  appearance: NativeIconAppearance,
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  return findNativeIconPath(input, APP_ICON_FILENAMES[appearance], fileExists);
}
