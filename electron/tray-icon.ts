import { existsSync } from "node:fs";
import { join } from "node:path";

export type NativeIconAppearance = "light" | "dark";

export const TRAY_ICON_FILENAMES = {
  light: "favicon-light.png",
  dark: "favicon-dark.png",
} as const;

export const WINDOWS_TRAY_ICON_FILENAMES = {
  light: "favicon-light-windows.ico",
  dark: "favicon-dark-windows.ico",
} as const;

/** One alpha mask; AppKit supplies the color for the actual menu-bar background. */
export const MAC_TRAY_ICON_FILENAMES = {
  standard: "trayTemplate.png",
  retina: "trayTemplate@2x.png",
} as const;

export const APP_ICON_FILENAMES = {
  light: "favicon-light-1024.png",
  dark: "favicon-dark-1024.png",
} as const;

/** The macOS Dock uses a white plate; the menu bar keeps its template mask. */
export const MAC_APP_ICON_FILENAME = "mac-app-1024.png";

/**
 * Windows taskbar/window icons are plate-free glyphs (no white/blue square
 * behind the mark). The ICO contains separately rasterized frames for the
 * taskbar and window sizes at each Windows display scale.
 */
export const WINDOWS_APP_ICON_FILENAMES = WINDOWS_TRAY_ICON_FILENAMES;

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

/** Resolve a native ICO on Windows, an AppKit template on macOS, or a PNG. */
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
  if (input.platform === "darwin") {
    return findNativeIconPath(
      input,
      MAC_TRAY_ICON_FILENAMES.standard,
      fileExists,
    );
  }
  const filenames =
    input.platform === "win32"
      ? WINDOWS_TRAY_ICON_FILENAMES
      : TRAY_ICON_FILENAMES;
  return findNativeIconPath(input, filenames[appearance], fileExists);
}

/** Resolve the Retina (@2x) menu-bar icon next to the 16px one on macOS. */
export function findTrayRetinaIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
  },
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  return findNativeIconPath(input, MAC_TRAY_ICON_FILENAMES.retina, fileExists);
}

/** Resolve each platform's app icon, keeping startup artwork theme-aware. */
export function findAppIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
    readonly platform?: NodeJS.Platform;
    readonly surface?: "window" | "startup";
  },
  appearance: NativeIconAppearance,
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  if (input.platform === "darwin" && input.surface !== "startup") {
    return findNativeIconPath(input, MAC_APP_ICON_FILENAME, fileExists);
  }
  const filenames =
    input.platform === "win32" && input.surface !== "startup"
      ? WINDOWS_APP_ICON_FILENAMES
      : APP_ICON_FILENAMES;
  return findNativeIconPath(input, filenames[appearance], fileExists);
}
