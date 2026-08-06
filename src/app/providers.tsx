import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { I18nProvider } from "../lib/i18n/context";
import type { Currency, Locale } from "../lib/i18n/locale";
import type { RatesSnapshot } from "../lib/pricing/server-fns";
import { ThemeProvider } from "../lib/theme";

/**
 * The only composition point for application-wide React providers.
 *
 * It is intentionally not mounted by a route yet: the route migration must
 * happen separately so introducing this boundary cannot change today's SSR or
 * client behaviour. Feature modules must consume these contexts, never create
 * replacement global providers of their own.
 */
export interface AppProvidersProps {
  readonly queryClient: QueryClient;
  readonly initialLocale?: Locale;
  readonly initialDisplayCurrency?: Currency;
  readonly initialRates?: RatesSnapshot | null;
  readonly children: ReactNode;
}

export function AppProviders({
  queryClient,
  initialLocale,
  initialDisplayCurrency,
  initialRates,
  children,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider
        initialLocale={initialLocale}
        initialDisplayCurrency={initialDisplayCurrency}
        initialRates={initialRates}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
