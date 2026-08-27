import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { APP_NAME } from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";

/** 自绘标题栏高度（px），与 styles.css 中 .aitracker-window-chrome 的 height 保持一致。 */
export const WINDOW_CHROME_HEIGHT = 36;

/** macOS 红绿灯按钮位于标题栏左侧，需要预留空间（hiddenInset 下约 78px）。 */
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
 * 打包桌面端的自绘标题栏：整条可拖拽（-webkit-app-region: drag），右侧提供
 * 最小化 / 最大化 / 关闭按钮（Windows/Linux；macOS 保留原生红绿灯按钮）。
 * 浏览器预览或浮窗（/widget?mode=float）中不渲染。
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
