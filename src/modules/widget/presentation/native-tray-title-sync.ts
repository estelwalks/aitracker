import { useCallback, useEffect } from "react";

import {
  buildMenuBarTitle,
  type MenuBarDisplayInput,
} from "./menu-bar-display";

export interface NativeTrayTitlePort {
  setTrayTitle(title: string): Promise<void>;
}

let lastRequestedTrayTitle: string | null = null;

/** Sync through an injected port so native Tray behavior is testable without Electron. */
export function syncNativeTrayTitle(
  desktop: NativeTrayTitlePort | undefined,
  display: MenuBarDisplayInput,
): Promise<void> | undefined {
  if (!desktop) return undefined;
  const title = buildMenuBarTitle(display);
  if (title === lastRequestedTrayTitle) return Promise.resolve();
  lastRequestedTrayTitle = title;
  return desktop.setTrayTitle(title).catch((error: unknown) => {
    if (lastRequestedTrayTitle === title) lastRequestedTrayTitle = null;
    throw error;
  });
}

/** Keep the native macOS Tray title aligned with the current renderer summary. */
export function useNativeTrayTitleSync(
  display: MenuBarDisplayInput,
  enabled = true,
): (dynamic: boolean) => void {
  const { detail, tokens, tool } = display;
  const sync = useCallback(
    (dynamic: boolean) => {
      const desktop =
        typeof window === "undefined" ? undefined : window.desktopApi;
      if (!enabled) return;
      const request = syncNativeTrayTitle(desktop, {
        dynamic,
        detail,
        tokens,
        tool,
      });
      if (request) void request.catch(() => undefined);
    },
    [detail, enabled, tokens, tool],
  );

  useEffect(() => {
    sync(display.dynamic);
  }, [display.dynamic, sync]);

  return sync;
}

export function __resetNativeTrayTitleSyncForTest(): void {
  lastRequestedTrayTitle = null;
}
