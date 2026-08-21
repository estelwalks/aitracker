import {
  Link,
  Outlet,
  HeadContent,
  Scripts,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { Toaster } from "sonner";

import { reportLovableError } from "../lib/lovable-error-reporting";
import {
  addChunkReloadNonce,
  claimChunkReload,
  isChunkLoadError,
} from "../lib/chunk-recovery";
import { useI18n } from "../lib/i18n/context";
import { AppShell } from "../components/AppShell";
import { AppProviders } from "./providers";
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
      initialCatalog={loaderData.catalog}
      initialDisplayCurrency={loaderData.displayCurrency}
      initialRates={loaderData.rates}
    >
      <NavigationPerformanceMarks />
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

/**
 * User Timing entries make page-switch latency inspectable in Chromium's
 * performance tools without persisting personal data or emitting telemetry.
 */
function NavigationPerformanceMarks() {
  const status = useRouterState({ select: (state) => state.status });
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const startedAt = useRef<number | null>(null);
  const lastRenderedPath = useRef<string | null>(null);

  useEffect(() => {
    if (typeof performance === "undefined") return;
    if (status === "pending") {
      if (startedAt.current == null) {
        startedAt.current = performance.now();
        performance.mark("trusttools:navigation:start");
      }
      return;
    }
    if (startedAt.current == null) return;
    performance.mark("trusttools:navigation:complete");
    performance.measure(
      `trusttools:navigation:${pathname}`,
      "trusttools:navigation:start",
      "trusttools:navigation:complete",
    );
    startedAt.current = null;
  }, [pathname, status]);

  // Pending state is intentionally absent for some cache hits. Record a
  // separate post-commit marker after two frames so automated route tests can
  // measure every actual sidebar click, including those fast paths.
  useEffect(() => {
    if (typeof performance === "undefined" || status === "pending") return;
    if (lastRenderedPath.current === pathname) return;
    let cancelled = false;
    const firstFrame = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        performance.mark(`trusttools:navigation:rendered:${pathname}`);
        lastRenderedPath.current = pathname;
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(firstFrame);
    };
  }, [pathname, status]);

  return null;
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
  useEffect(() => {
    if (!isChunkLoadError(error)) return;
    console.error("Route chunk failed; attempting one safe reload", error);
    if (claimChunkReload(window.sessionStorage, window.location.pathname)) {
      window.location.replace(
        addChunkReloadNonce(window.location.href, Date.now()),
      );
    }
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
  useEffect(() => {}, []);
  return null;
}
