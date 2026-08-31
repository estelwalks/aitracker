import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { APP_NAME } from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";

/** The height of the self-drawn title bar (px) is consistent with the height of .aitracker-window-chrome in styles.css. */
export const WINDOW_CHROME_HEIGHT = 36;

/** The macOS traffic light button is located on the left side of the title bar and requires space (about 78px under hiddenInset). */
const MAC_TRAFFIC_LIGHT_INSET = 78;

type DesktopApi = NonNullable<Window["desktopApi"]>;

type WindowChromeEnvironment = Readonly<{
  desktop: DesktopApi;
  isMac: boolean;
}>;

/** Pure platform classifier kept independent from browser globals for tests. */
function isMacDesktopUserAgent(userAgent: string): boolean {
  return /Mac|iPhone|iPad/.test(userAgent) && !/Windows|Linux/.test(userAgent);
}

/**
 * Browser globals are intentionally resolved only from an effect. Returning
 * null keeps SSR and the client's hydration render byte-for-byte equivalent.
 */
function resolveWindowChromeEnvironment(
  desktop: Window["desktopApi"],
  userAgent: string,
): WindowChromeEnvironment | null {
  if (!desktop) return null;
  return { desktop, isMac: isMacDesktopUserAgent(userAgent) };
}

/**
 * Package the self-drawn title bar on the desktop: the entire bar can be dragged (-webkit-app-region: drag), provided on the right
 * Minimize/Maximize/Close buttons (Windows/Linux; macOS retains native traffic light buttons).
 * Not rendered in browser preview or floating window (/widget?mode=float).
 */
export function WindowChrome() {
  const { t } = useI18n();
  const [environment, setEnvironment] =
    useState<WindowChromeEnvironment | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const nextEnvironment = resolveWindowChromeEnvironment(
      window.desktopApi,
      navigator.userAgent,
    );
    setEnvironment(nextEnvironment);
  }, []);

  useEffect(() => {
    const desktop = environment?.desktop;
    if (!desktop) return undefined;
    let cancelled = false;
    void desktop
      .isWindowMaximized()
      .then((value) => {
        if (!cancelled) setMaximized(value);
      })
      .catch(() => {});
    const unsubscribe = desktop.onWindowMaximizedChanged((value) => {
      if (!cancelled) setMaximized(value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [environment]);

  if (!environment) return null;

  const { desktop, isMac } = environment;

  return (
    <div
      className={`aitracker-window-chrome ${isMac ? "aitracker-window-chrome--mac" : ""}`}
      style={isMac ? { paddingLeft: MAC_TRAFFIC_LIGHT_INSET } : undefined}
    >
      {!isMac && (
        <div className="aitracker-window-chrome-title">{APP_NAME}</div>
      )}

      {!isMac && (
        <div className="aitracker-window-controls">
          <button
            type="button"
            className="aitracker-window-control"
            title={t("common.windowMinimize")}
            onClick={() => void desktop.minimizeWindow()}
          >
            <Minus className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="aitracker-window-control"
            title={
              maximized ? t("common.windowRestore") : t("common.windowMaximize")
            }
            onClick={() =>
              void desktop.toggleMaximizeWindow().then(setMaximized)
            }
          >
            {maximized ? (
              <Copy className="size-3.5" strokeWidth={1.5} />
            ) : (
              <Square className="size-3.5" strokeWidth={1.5} />
            )}
          </button>
          <button
            type="button"
            className="aitracker-window-control aitracker-window-control--close"
            title={t("common.close")}
            onClick={() => void desktop.closeWindow()}
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
