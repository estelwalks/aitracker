import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";

import { APP_NAME } from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";

/** 自绘标题栏高度（px），与 styles.css 中 .tt-window-chrome 的 height 保持一致。 */
export const WINDOW_CHROME_HEIGHT = 36;

/** macOS 红绿灯按钮位于标题栏左侧，需要预留空间（hiddenInset 下约 78px）。 */
const MAC_TRAFFIC_LIGHT_INSET = 78;

function detectMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Mac|iPhone|iPad/.test(ua) && !/Windows|Linux/.test(ua);
}

/**
 * 打包桌面端的自绘标题栏：整条可拖拽（-webkit-app-region: drag），右侧提供
 * 最小化 / 最大化 / 关闭按钮（Windows/Linux；macOS 保留原生红绿灯按钮）。
 * 浏览器预览或浮窗（/widget?mode=float）中不渲染。
 */
export function WindowChrome() {
  const { t } = useI18n();
  const desktop = typeof window !== "undefined" ? window.desktopApi : undefined;
  const isMac = detectMacPlatform();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
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
  }, [desktop]);

  if (!desktop) return null;

  return (
    <div
      className={`tt-window-chrome ${isMac ? "tt-window-chrome--mac" : ""}`}
      style={isMac ? { paddingLeft: MAC_TRAFFIC_LIGHT_INSET } : undefined}
    >
      <div className="tt-window-chrome-title">{APP_NAME}</div>

      {!isMac && (
        <div className="tt-window-controls">
          <button
            type="button"
            className="tt-window-control"
            title={t("common.windowMinimize")}
            onClick={() => void desktop.minimizeWindow()}
          >
            <Minus className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="tt-window-control"
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
            className="tt-window-control tt-window-control--close"
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
