import { catalogs, getMessage } from "./i18n/messages";
import { resolveLocaleFromSearchParam, type Locale } from "./i18n/locale";

/**
 * SSR error page (rendered outside the React tree). Accepts an optional raw
 * request URL so the fallback page can honor `?locale=`; otherwise zh-CN.
 */
export function renderErrorPage(rawUrl?: string | null): string {
  const locale: Locale =
    rawUrl == null
      ? "zh-CN"
      : (resolveLocaleFromSearchParam(
          new URL(rawUrl).searchParams.get("locale"),
        ) ?? "zh-CN");
  const t = (key: string, params?: Record<string, string | number>) =>
    getMessage(catalogs[locale], key, params);
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <title>${t("common.pageLoadFailed")}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${t("common.pageLoadFailed")}</h1>
      <p>${t("common.localServiceUnavailable")}</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">${t("common.reload")}</button>
        <a class="secondary" href="/">${t("common.backHome")}</a>
      </div>
    </div>
  </body>
</html>`;
}
