import type { DesktopLocale } from "./contracts.js";

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
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TrustTools</title></head>
  <body><main aria-label="TrustTools ${message}"><div class="mark">TT</div><h1>TrustTools</h1><p>${message}</p><span aria-hidden="true"></span></main></body>
  <style>
    :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0b10;color:#f4f4f5;font-family:"Inter Variable","Noto Sans SC Variable","Segoe UI Variable","Segoe UI",-apple-system,BlinkMacSystemFont,system-ui,"PingFang SC","Hiragino Sans GB","Microsoft YaHei UI","Microsoft YaHei",sans-serif}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;letter-spacing:.01em}.mark{display:grid;place-items:center;width:44px;height:44px;border-radius:10px;background:#f4f4f5;color:#0b0b10;font:800 15px "JetBrains Mono Variable","Cascadia Mono",ui-monospace,SFMono-Regular,Menlo,monospace}h1{margin:4px 0 0;font-size:18px;font-weight:650}p{margin:0;color:#a1a1aa;font-size:13px}span{width:96px;height:2px;overflow:hidden;border-radius:99px;background:#27272a}span::after{content:"";display:block;width:45%;height:100%;border-radius:inherit;background:#f4f4f5;animation:load 1.1s ease-in-out infinite}@keyframes load{from{transform:translateX(-120%)}to{transform:translateX(260%)}}</style>
</html>`)}`;
}
