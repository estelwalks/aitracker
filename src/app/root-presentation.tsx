import {
  Link,
  Outlet,
  HeadContent,
  Scripts,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import { reportLovableError } from "../lib/lovable-error-reporting";
import { useI18n } from "../lib/i18n/context";
import { AppShell } from "../components/AppShell";
import { AppProviders } from "./providers";
import { seedDailyCountFromPlatform } from "../lib/security/daily-limit";
import type { QueryClient } from "@tanstack/react-query";
import type { RootLoaderData } from "./root-route-config";

export function RootShell({
  locale,
  children,
}: {
  readonly locale: RootLoaderData["locale"];
  readonly children: ReactNode;
}) {
  return (
    <html lang={locale}>
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

export function RootComponent({
  queryClient,
  loaderData,
}: {
  readonly queryClient: QueryClient;
  readonly loaderData: RootLoaderData;
}) {
  return (
    <AppProviders
      queryClient={queryClient}
      initialLocale={loaderData.locale}
      initialDisplayCurrency={loaderData.displayCurrency}
      initialRates={loaderData.rates}
    >
      <PlatformPersistenceSeed />
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{ duration: 3000 }}
      />
    </AppProviders>
  );
}

export function NotFoundComponent() {
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

export function ErrorComponent({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
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

function PlatformPersistenceSeed() {
  useEffect(() => {
    void seedDailyCountFromPlatform();
  }, []);
  return null;
}
