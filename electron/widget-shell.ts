const WIDGET_WIDTH = 420;
const WIDGET_HEIGHT = 680;

/** Lightweight first paint shown before the local widget route is ready. */
export function createWidgetShellHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; background: transparent; overflow: hidden; }
    body { display: grid; place-items: stretch; font-family: "Inter Variable", "Noto Sans SC Variable", sans-serif; font-synthesis: none; }
    .shell {
      width: ${WIDGET_WIDTH}px;
      height: ${WIDGET_HEIGHT}px;
      padding: 18px;
      overflow: hidden;
      color: rgba(255,255,255,.9);
      background: linear-gradient(135deg, rgba(105,88,92,.88), rgba(30,47,70,.9));
      border: 1px solid rgba(255,255,255,.24);
      border-radius: 30px;
      box-shadow: inset 0 1px rgba(255,255,255,.32), 0 24px 70px rgba(8,14,25,.38);
    }
    .header { display: flex; align-items: center; gap: 9px; font-size: 16px; font-weight: 700; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.35); }
    .line { height: 10px; margin-top: 22px; border-radius: 999px; background: rgba(255,255,255,.11); }
    .line.short { width: 44%; }
    .cards { display: grid; grid-template-columns: repeat(2,1fr); gap: 10px; margin-top: 18px; }
    .card { height: 106px; border-radius: 18px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.09); }
    .panel { height: 210px; margin-top: 12px; border-radius: 20px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.08); }
  </style>
</head>
<body>
  <main class="shell" aria-label="TrustTools widget loading">
    <div class="header">TrustTools <span class="dot"></span></div>
    <div class="line short"></div>
    <div class="cards"><div class="card"></div><div class="card"></div></div>
    <div class="panel"></div>
    <div class="line"></div>
    <div class="line short"></div>
  </main>
</body>
</html>`;
}

export function createWidgetShellDataUrl(): string {
  return `data:text/html;base64,${Buffer.from(createWidgetShellHtml(), "utf8").toString("base64")}`;
}
