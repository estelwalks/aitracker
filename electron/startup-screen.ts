import type { DesktopLocale } from "./contracts.js";
import { APP_NAME } from "./app-config.js";

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
export function createStartupDocument(locale: DesktopLocale): string {
  const message = startupMessages[locale].preparing;
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="${locale}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${APP_NAME}</title></head>
  <body><main aria-label="${APP_NAME} ${message}"><div class="mark" aria-hidden="true"><svg viewBox="0 0 18 18"><g fill="none" stroke="#0b0b10" stroke-linecap="round" stroke-width="1.55"><path d="M6.7 2.8H5A2.2 2.2 0 0 0 2.8 5v1.7M11.3 2.8H13A2.2 2.2 0 0 1 15.2 5v1.7M2.8 11.3V13A2.2 2.2 0 0 0 5 15.2h1.7M15.2 11.3V13a2.2 2.2 0 0 1-2.2 2.2h-1.7"/><path d="m5.1 13.4 1.5-3.1m1.7 3.8 1.9-4.4m1.6 4.4 2.1-6"/></g><circle cx="6.8" cy="9.9" r="1.05" fill="#0b0b10"/><circle cx="9.5" cy="9" r="1.2" fill="#0b0b10"/><circle cx="12.3" cy="7.1" r="1.4" fill="#0b0b10"/></svg></div><h1>${APP_NAME}</h1><p>${message}</p><span aria-hidden="true"></span></main></body>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0b10;color:#f4f4f5;font-family:"Inter Variable","Noto Sans SC Variable",sans-serif;font-synthesis:none}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;letter-spacing:.01em}.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#f4f4f5;color:#0b0b10}.mark svg{width:31px;height:31px}h1{margin:4px 0 0;font-size:18px;font-weight:650}p{margin:0;color:#a1a1aa;font-size:13px}span{width:96px;height:2px;overflow:hidden;border-radius:99px;background:#27272a}span::after{content:"";display:block;width:45%;height:100%;border-radius:inherit;background:#f4f4f5;animation:load 1.1s ease-in-out infinite}@keyframes load{from{transform:translateX(-120%)}to{transform:translateX(260%)}}</style>
</html>`)}`;
}
