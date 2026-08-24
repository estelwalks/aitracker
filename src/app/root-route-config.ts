import appCss from "../styles.css?url";
import { APP_NAME, brandParams } from "../lib/app-config";
import { loadCatalog } from "../lib/i18n/catalog-loader";
import { getMessage } from "../lib/i18n/message-resolver";
import type { Translations } from "../lib/i18n/schema";
import {
  mapSystemCurrency,
  resolveCurrencyFromSearch,
  resolveLocaleFromSearch,
  type Currency,
  type Locale,
} from "../lib/i18n/locale";
import {
  getRatesSnapshot,
  type RatesSnapshot,
} from "../lib/pricing/server-fns";

export interface RootLoaderData {
  readonly locale: Locale;
  readonly displayCurrency: Currency;
  readonly rates: RatesSnapshot | null;
  readonly catalog: Translations;
}

export async function rootLoader({
  location,
}: {
  location: { search: Record<string, unknown> };
}): Promise<RootLoaderData> {
  const locale = resolveLocaleFromSearch(location.search);
  let rates: RatesSnapshot | null = null;
  try {
    rates = await getRatesSnapshot({ data: false });
  } catch {
    /* best effort */
  }
  return {
    locale,
    catalog: await loadCatalog(locale),
    displayCurrency: resolveCurrencyFromSearch(
      location.search,
      mapSystemCurrency(locale),
    ),
    rates,
  };
}

export function rootHead({ loaderData }: { loaderData?: RootLoaderData }) {
  const locale = loaderData?.locale ?? "zh-CN";
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        title: loaderData?.catalog
          ? getMessage(loaderData.catalog, "meta.title", brandParams)
          : APP_NAME,
      },
      {
        name: "description",
        content: loaderData?.catalog
          ? getMessage(loaderData.catalog, "meta.description", brandParams)
          : APP_NAME,
      },
      { name: "author", content: APP_NAME },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "preconnect",
        href: "https://fonts.googleapis.com",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap",
      },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  };
}
