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
  completeChunkRecovery,
  isChunkLoadError,
} from "../lib/chunk-recovery";
import { useI18n } from "../lib/i18n/context";
import { useTheme } from "../lib/theme";
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
      <RootAppContent />
    </AppProviders>
  );
}

function RootAppContent() {
  const { theme } = useTheme();
  return (
    <>
      <HydrationMarker />
      <ChunkRecoveryCompletion />
      <NavigationPerformanceMarks />
      <PlatformPersistenceSeed />
      <AppShell>
        <Outlet />
      </AppShell>
      <Toaster
        position="top-right"
        theme={theme}
        toastOptions={{ duration: 3000 }}
      />
    </>
  );
}

/**
 * Expose a small, privacy-neutral readiness signal for browser automation and
 * integrations that need to wait until the interactive React tree is mounted.
 * Server-rendered controls can otherwise be visible for a brief interval
 * before their event handlers are attached.
 */
function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.aitrackerHydrated = "true";
    return () => {
      delete document.documentElement.dataset.aitrackerHydrated;
    };
  }, []);

  return null;
}

/**
 * A successful cache-busted reload proves that the current document and its
 * hashed chunks agree. Clear the one-shot guard so a future deployment can
 * recover in the same browser session without asking the user to clear cache.
 */
function ChunkRecoveryCompletion() {
  useEffect(() => {
    const cleanHref = completeChunkRecovery(
      window.sessionStorage,
      window.location.href,
    );
    if (cleanHref) {
      window.history.replaceState(window.history.state, "", cleanHref);
    }
  }, []);

  return null;
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
        performance.mark("aitracker:navigation:start");
      }
      return;
    }
    if (startedAt.current == null) return;
    performance.mark("aitracker:navigation:complete");
    performance.measure(
      `aitracker:navigation:${pathname}`,
      "aitracker:navigation:start",
      "aitracker:navigation:complete",
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
        performance.mark(`aitracker:navigation:rendered:${pathname}`);
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
        <h1 className="aitracker-num text-7xl font-bold text-foreground">
          404
        </h1>
        <h2 className="aitracker-text-section-title mt-4 font-semibold text-foreground">
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
        <h1 className="aitracker-text-page-title font-semibold tracking-tight text-foreground">
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
