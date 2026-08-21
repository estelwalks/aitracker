import appCss from "../styles.css?url";
import { APP_NAME, brandParams } from "../lib/app-config";
import {
  catalogFor,
  getMessage,
  loadCatalog,
  type Translations,
} from "../lib/i18n/messages";
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
  /** The active locale only; it seeds browser i18n without loading all locales. */
  readonly catalog: Translations;
  readonly displayCurrency: Currency;
  readonly rates: RatesSnapshot | null;
}

export async function rootLoader({
  location,
}: {
  location: { search: Record<string, unknown> };
}): Promise<RootLoaderData> {
  const locale = resolveLocaleFromSearch(location.search);
  const [catalog, rates] = await Promise.all([
    loadCatalog(locale),
    getRatesSnapshot({ data: false }).catch(() => null),
  ]);
  return {
    locale,
    catalog,
    displayCurrency: resolveCurrencyFromSearch(
      location.search,
      mapSystemCurrency(locale),
    ),
    rates,
  };
}

export function rootHead({ loaderData }: { loaderData?: RootLoaderData }) {
  const locale = loaderData?.locale ?? "zh-CN";
  const catalog = loaderData?.catalog ?? catalogFor(locale);
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: getMessage(catalog, "meta.title", brandParams) },
      {
        name: "description",
        content: getMessage(catalog, "meta.description", brandParams),
      },
      { name: "author", content: APP_NAME },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      // Desktop starts must remain offline-safe. The CSS font stacks prefer
      // the platform's native UI and monospace fonts, avoiding a remote font
      // request that can hold up text settling on an offline machine.
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  };
}
