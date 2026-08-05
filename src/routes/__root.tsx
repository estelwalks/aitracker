import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { I18nProvider, useI18n } from "../lib/i18n/context";
import { catalogs, getMessage } from "../lib/i18n/messages";
import { APP_NAME, brandParams } from "../lib/app-config";
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
import { ThemeProvider } from "../lib/theme";
import { AppShell } from "../components/AppShell";
import { refreshLocalUsageSnapshot } from "../lib/local-usage";
import { seedDailyCountFromPlatform } from "../lib/security/daily-limit";

function NotFoundComponent() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="tt-num text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          {t("common.notFound")}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("common.notFoundDesc")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("common.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const { t } = useI18n();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("common.pageLoadFailed")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("common.pageLoadFailedDesc")}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("common.retry")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-sm border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("common.backHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

interface RootLoaderData {
  /**
   * Locale resolved from the request URL (`?locale=`). Electron's main process
   * appends it from prefs/system language so SSR renders the right language on
   * first paint; the browser dev client mirrors user choices into the URL.
   */
  locale: Locale;
  /** Display currency resolved from `?currency=` (Electron) or the locale. */
  displayCurrency: Currency;
  /** Exchange rates read server-side for the first frame. */
  rates: RatesSnapshot | null;
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    loader: async ({ location }) => {
      const locale = resolveLocaleFromSearch(location.search);
      let rates: RatesSnapshot | null = null;
      try {
        rates = await getRatesSnapshot({ data: false });
      } catch {
        // First-frame rates are best-effort; the provider refreshes silently.
      }
      return {
        locale,
        displayCurrency: resolveCurrencyFromSearch(
          location.search,
          mapSystemCurrency(locale),
        ),
        rates,
      };
    },
    head: ({ loaderData }) => {
      const locale = loaderData?.locale ?? "zh-CN";
      return {
        meta: [
          { charSet: "utf-8" },
          { name: "viewport", content: "width=device-width, initial-scale=1" },
          { title: getMessage(catalogs[locale], "meta.title", brandParams) },
          {
            name: "description",
            content: getMessage(
              catalogs[locale],
              "meta.description",
              brandParams,
            ),
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
    },
    shellComponent: RootShell,
    component: RootComponent,
    notFoundComponent: NotFoundComponent,
    errorComponent: ErrorComponent,
  },
);

function RootShell({ children }: { children: ReactNode }) {
  const loaderData = Route.useLoaderData();
  return (
    <html lang={loaderData?.locale ?? "zh-CN"}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const loaderData = Route.useLoaderData();

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider
        initialLocale={loaderData?.locale}
        initialDisplayCurrency={loaderData?.displayCurrency}
        initialRates={loaderData?.rates}
      >
        <ThemeProvider>
          <PlatformPersistenceSeed />
          <LocalUsageAutoRefresh />
          <AppShell>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </AppShell>
          <Toaster
            position="top-right"
            theme="dark"
            toastOptions={{ duration: 3000 }}
          />
        </ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}

function PlatformPersistenceSeed() {
  useEffect(() => {
    void seedDailyCountFromPlatform();
  }, []);
  return null;
}

function LocalUsageAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let refreshing = false;
    let lastRefresh = Date.now();

    const refresh = async (force = false) => {
      const pathname = router.state.location.pathname;
      if (
        refreshing ||
        document.visibilityState !== "visible" ||
        (pathname !== "/" &&
          pathname !== "/sessions" &&
          pathname !== "/sources")
      ) {
        return;
      }
      const interval = 5_000;
      if (!force && Date.now() - lastRefresh < interval) return;

      refreshing = true;
      try {
        await refreshLocalUsageSnapshot();
        lastRefresh = Date.now();
        await router.invalidate();
      } catch {
        return;
      } finally {
        refreshing = false;
      }
    };

    const timer = window.setInterval(() => void refresh(), 5_000);
    const onFocus = () => void refresh(true);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  return null;
}
