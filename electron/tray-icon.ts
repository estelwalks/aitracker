import { existsSync } from "node:fs";
import { join } from "node:path";

export type NativeIconAppearance = "light" | "dark";

export const TRAY_ICON_FILENAMES = {
  light: "favicon-light.png",
  dark: "favicon-dark.png",
} as const;

/**
 * The Windows tray keeps the transparent, theme-aware ICO.
 *
 * A plated icon is right for the desktop and the taskbar, where it sits over a
 * wallpaper at 24-48px, and wrong in the notification area: at 16px a white
 * rounded square is the unclear shape. These files therefore stay plate-free.
 */
export const WINDOWS_TRAY_ICON_FILENAMES = {
  light: "favicon-light-windows.ico",
  dark: "favicon-dark-windows.ico",
} as const;

/** One alpha mask; AppKit supplies the color for the actual menu-bar background. */
export const MAC_TRAY_ICON_FILENAMES = {
  standard: "trayTemplate.png",
  retina: "trayTemplate@2x.png",
} as const;

/**
 * Linux status-area artwork.
 *
 * The final fallback (`favicon-*.png`) is a 16px bitmap, which a panel drawing
 * the icon at 22–24px would upscale. These are rasterized at the panel size,
 * with the 44/48 variants supplied as the 2× representation for HiDPI panels.
 * Unlike macOS there is no template mask: the theme picks the ink color, and
 * the panel background does not always match the GTK theme.
 */
export const LINUX_TRAY_ICON_FILENAMES = {
  light: "linux/tray-light-22.png",
  dark: "linux/tray-dark-22.png",
} as const;

export const LINUX_TRAY_RETINA_ICON_FILENAMES = {
  light: "linux/tray-light-44.png",
  dark: "linux/tray-dark-44.png",
} as const;

export const APP_ICON_FILENAMES = {
  light: "favicon-light-1024.png",
  dark: "favicon-dark-1024.png",
} as const;

/** The macOS Dock uses a white plate; the menu bar keeps its template mask. */
export const MAC_APP_ICON_FILENAME = "mac-app-1024.png";

/**
 * The Windows app icon: one white-plated ICO shared by the EXE, the desktop and
 * Start-menu shortcuts, the running window and the taskbar.
 *
 * The plate is what makes the icon readable over a wallpaper; electron-builder
 * embeds the same artwork as `icon.ico`, so the shortcut and its running window
 * cannot drift apart. The tray keeps the transparent ICOs above.
 */
export const WINDOWS_APP_ICON_FILENAME = "windows-app.ico";

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
  if (input.platform === "linux") {
    return findNativeIconPath(
      input,
      LINUX_TRAY_ICON_FILENAMES[appearance],
      fileExists,
    );
  }
  const filenames =
    input.platform === "win32"
      ? WINDOWS_TRAY_ICON_FILENAMES
      : TRAY_ICON_FILENAMES;
  return findNativeIconPath(input, filenames[appearance], fileExists);
}

/**
 * Resolve the 2× Linux status icon, so a HiDPI panel gets real pixels instead
 * of an upscaled 22px bitmap. Returns null on every other platform.
 */
export function findLinuxTrayRetinaIconPath(
  input: {
    readonly isPackaged: boolean;
    readonly resourcesPath: string;
    readonly appPath: string;
    readonly platform?: NodeJS.Platform;
  },
  appearance: NativeIconAppearance,
  fileExists: (path: string) => boolean = existsSync,
): string | null {
  return findNativeIconPath(
    input,
    LINUX_TRAY_RETINA_ICON_FILENAMES[appearance],
    fileExists,
  );
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
  // Windows uses the plated ICO on every surface, the startup screen included:
  // it is theme-independent, so there is no appearance to pick and no reason for
  // the icon to change between the first frame and the running window.
  if (input.platform === "win32") {
    return findNativeIconPath(input, WINDOWS_APP_ICON_FILENAME, fileExists);
  }
  return findNativeIconPath(input, APP_ICON_FILENAMES[appearance], fileExists);
}
