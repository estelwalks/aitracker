import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { APP_NAME } from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";
import { usePlatform } from "../lib/platform";

/** The height of the self-drawn title bar (px) is consistent with the height of .aitracker-window-chrome in styles.css. */
export const WINDOW_CHROME_HEIGHT = 36;

/** The macOS traffic light button is located on the left side of the title bar and requires space (about 78px under hiddenInset). */
const MAC_TRAFFIC_LIGHT_INSET = 78;

type DesktopApi = NonNullable<Window["desktopApi"]>;

/**
 * The bridge methods this component needs. A preload that trims them would
 * otherwise throw *synchronously* inside the effect — a `.catch()` only covers a
 * rejected promise, so the whole title bar would render blank. Guarding the
 * shape is cheap and the bridge is not guaranteed to be complete.
 */
type MaximizeAwareDesktopApi = DesktopApi & {
  isWindowMaximized: () => Promise<boolean>;
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void) => () => void;
  toggleMaximizeWindow: () => Promise<boolean>;
  minimizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
};

function supportsMaximizeTracking(
  desktop: DesktopApi,
): desktop is MaximizeAwareDesktopApi {
  return (
    typeof desktop.isWindowMaximized === "function" &&
    typeof desktop.onWindowMaximizedChanged === "function" &&
    typeof desktop.toggleMaximizeWindow === "function"
  );
}

/**
 * Browser globals are intentionally resolved only from an effect. Returning
 * null keeps SSR and the client's hydration render byte-for-byte equivalent.
 *
 * The window controls are drawn whenever the desktop bridge exists AND the host
 * is not macOS. macOS keeps its native traffic lights, so drawing a second set
 * would duplicate them; every other platform runs frameless and needs them.
 */
function resolveWindowChromeEnvironment(
  desktop: Window["desktopApi"],
): DesktopApi | null {
  return desktop ?? null;
}

/**
 * Package the self-drawn title bar on the desktop: the entire bar can be
 * dragged (`-webkit-app-region: drag`), with minimize/maximize/close provided on
 * the right (Windows and Linux; macOS retains its native traffic lights and
 * only gets the drag region). Not rendered in browser preview or the floating
 * window (`/widget?mode=float`).
 */
export function WindowChrome() {
  const { t } = useI18n();
  const { isMac } = usePlatform();
  const [desktop, setDesktop] = useState<DesktopApi | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    setDesktop(resolveWindowChromeEnvironment(window.desktopApi));
  }, []);

  useEffect(() => {
    if (!desktop) return undefined;
    if (!supportsMaximizeTracking(desktop)) return undefined;
    let cancelled = false;
    void desktop
      .isWindowMaximized()
      .then((value) => {
        if (!cancelled) setMaximized(value);
      })
      .catch(() => {});
    try {
      const unsubscribe = desktop.onWindowMaximizedChanged((value) => {
        if (!cancelled) setMaximized(value);
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    } catch {
      // A bridge that advertises the method but throws on subscription must not
      // take the title bar down with it.
      return () => {
        cancelled = true;
      };
    }
  }, [desktop]);

  if (!desktop) return null;

  const canMaximize = supportsMaximizeTracking(desktop);
  const canMinimize = typeof desktop.minimizeWindow === "function";
  const canClose = typeof desktop.closeWindow === "function";
  const toggleMaximize = () => {
    if (!canMaximize) return;
    void desktop.toggleMaximizeWindow().then(setMaximized);
  };

  return (
    <div
      className={`aitracker-window-chrome ${isMac ? "aitracker-window-chrome--mac" : ""}`}
      style={isMac ? { paddingLeft: MAC_TRAFFIC_LIGHT_INSET } : undefined}
      // A frameless window does not get double-click-to-maximize from the window
      // manager on Linux (nor on Windows), so the self-drawn bar provides it.
      onDoubleClick={isMac || !canMaximize ? undefined : toggleMaximize}
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
            disabled={!canMinimize}
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
            disabled={!canMaximize}
            onClick={toggleMaximize}
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
            disabled={!canClose}
            onClick={() => void desktop.closeWindow()}
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      )}
    </div>
  );
}
