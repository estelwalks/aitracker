import type { DesktopLocale } from "./contracts.js";
import { APP_NAME } from "./app-config.js";
import type { NativeIconAppearance } from "./tray-icon.js";

const startupMessages: Record<DesktopLocale, { readonly preparing: string }> = {
  "zh-CN": { preparing: "正在准备本地工作区…" },
  "en-US": { preparing: "Preparing your local workspace…" },
  "ja-JP": { preparing: "ローカルワークスペースを準備しています…" },
  "ko-KR": { preparing: "로컬 작업 공간을 준비하고 있습니다…" },
};

/**
 * Self-contained first frame shown before the local web server is available.
 * It must not depend on the renderer's i18n chunks or persisted preferences.
 */
export function createStartupDocument(
  locale: DesktopLocale,
  appearance: NativeIconAppearance,
  logoDataUrl: string,
): string {
  const message = startupMessages[locale].preparing;
  const palette =
    appearance === "light"
      ? {
          background: "#f6f7f9",
          foreground: "#101218",
          muted: "#626776",
          track: "#dfe2e8",
          indicator: "#20242c",
        }
      : {
          background: "#0b0b10",
          foreground: "#f4f4f5",
          muted: "#a1a1aa",
          track: "#27272a",
          indicator: "#f4f4f5",
        };
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="${locale}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP_NAME}</title></head>
  <body><main aria-label="${APP_NAME} ${message}"><img class="mark" src="${logoDataUrl}" alt="" aria-hidden="true"><h1>${APP_NAME}</h1><p>${message}</p><span aria-hidden="true"></span></main></body>
  <style>
    :root{color-scheme:${appearance};--background:${palette.background};--foreground:${palette.foreground};--muted:${palette.muted};--track:${palette.track};--indicator:${palette.indicator}}*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font-family:"Inter Variable","Noto Sans SC Variable",sans-serif;font-synthesis:none}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;letter-spacing:.01em}.mark{display:block;width:52px;height:52px;border-radius:12px}h1{margin:4px 0 0;font-size:18px;font-weight:650}p{margin:0;color:var(--muted);font-size:13px}span{width:96px;height:2px;overflow:hidden;border-radius:99px;background:var(--track)}span::after{content:"";display:block;width:45%;height:100%;border-radius:inherit;background:var(--indicator);animation:load 1.1s ease-in-out infinite}@keyframes load{from{transform:translateX(-120%)}to{transform:translateX(260%)}}</style>
</html>`)}`;
}
