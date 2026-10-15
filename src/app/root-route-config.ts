import appCss from "../styles.css?url";
import {
  APP_FAVICON_DARK_URL,
  APP_FAVICON_LIGHT_URL,
  APP_NAME,
  brandParams,
} from "../lib/app-config";
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
import { hostPlatformFromNode, type HostPlatform } from "../lib/platform";
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
  /**
   * The operating system this server runs on. In the desktop build the local
   * web server runs inside the Electron main process, so this is the same
   * machine as the window and `process.platform` is known synchronously — which
   * is what makes it hydration-stable. A browser talking to a remote host gets
   * that host's value, hence the name.
   */
  readonly hostPlatform: HostPlatform;
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
    hostPlatform: hostPlatformFromNode(process.platform),
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
    ],
    links: [
      // Desktop starts must remain offline-safe. The CSS font stacks prefer
      // the platform's native UI and monospace fonts, avoiding a remote font
      // request that can hold up text settling on an offline machine.
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        id: "app-favicon-light",
        href: APP_FAVICON_LIGHT_URL,
        type: "image/svg+xml",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        id: "app-favicon-dark",
        href: APP_FAVICON_DARK_URL,
        type: "image/svg+xml",
        media: "(prefers-color-scheme: dark)",
      },
    ],
  };
}
