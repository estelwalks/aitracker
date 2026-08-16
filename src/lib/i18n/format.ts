import type { Locale } from "./locale";

/**
 * Locale-aware formatting — the single entry point for dates, numbers, money,
 * percentages, token counts and byte sizes. All functions are pure
 * `(locale, ...)`; components use the bound formatters from `useI18n()`.
 *
 * Business layers keep saving machine-readable numbers and ISO timestamps;
 * formatting happens only at the display boundary.
 */

export interface MoneyFormatOptions {
  /** Minimum fraction digits (default 2, 0 for amounts ≥ 100). */
  minimumFractionDigits?: number;
  /** Maximum fraction digits (default 4, 0 for amounts ≥ 100). */
  maximumFractionDigits?: number;
}

const NAN_CHAR = "—";

export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return NAN_CHAR;
  return new Intl.NumberFormat(locale, options).format(value);
}

/** `value` is a percentage in 0–100 (e.g. 45.2 → "45.2%"). */
export function formatPercent(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  if (!Number.isFinite(value)) return NAN_CHAR;
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
    ...options,
  }).format(value / 100);
}

/** Date-only formatting (default YYYY/MM/DD-ish per locale). */
export function formatDate(
  locale: Locale,
  value: Date | string | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = toDate(value);
  if (date == null) return NAN_CHAR;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...options,
  }).format(date);
}

/**
 * Date-time formatting. `withSeconds` mirrors the previous
 * `formatDateTime`/`formatEventTime` split in `lib/local-usage/presentation.ts`.
 */
export function formatDateTime(
  locale: Locale,
  value: string | Date,
  withSeconds = true,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return NAN_CHAR;
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(date);
}

/**
 * Currency fraction-digit rules (docs/plan v1.2 展示货币策略):
 * JPY/KRW always use 0 digits; CNY/USD keep the magnitude-based behavior
 * (0 digits for amounts ≥ 100, otherwise 2–4).
 */
function currencyFractionDigits(
  currency: string,
  amount: number,
  options?: MoneyFormatOptions,
): { minimumFractionDigits: number; maximumFractionDigits: number } {
  if (
    options?.minimumFractionDigits != null ||
    options?.maximumFractionDigits != null
  ) {
    return {
      minimumFractionDigits: options?.minimumFractionDigits ?? 0,
      maximumFractionDigits: options?.maximumFractionDigits ?? 2,
    };
  }
  if (currency === "JPY" || currency === "KRW") {
    return { minimumFractionDigits: 0, maximumFractionDigits: 0 };
  }
  const autoDigits = Math.abs(amount) >= 100;
  return {
    minimumFractionDigits: autoDigits ? 0 : 2,
    maximumFractionDigits: autoDigits ? 0 : 4,
  };
}

/**
 * Format an amount in its own currency. The currency itself never changes
 * with the UI language — a CNY amount stays CNY (e.g. `CN¥12.34` in en-US).
 * Conversion from USD happens in the pricing module, not here.
 */
export function formatMoney(
  locale: Locale,
  amount: number,
  currency: string,
  options?: MoneyFormatOptions,
): string {
  if (!Number.isFinite(amount)) return NAN_CHAR;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    ...currencyFractionDigits(currency, amount, options),
  }).format(amount);
}

/**
 * Token counts with compact K/M/B suffixes (language-neutral). Base values use
 * the locale's number grouping; suffix digits follow the previous
 * `formatTokens` in `lib/local-usage/presentation.ts`.
 */
export function formatTokens(locale: Locale, value: number): string {
  if (!Number.isFinite(value)) return NAN_CHAR;
  if (value >= 1_000_000_000) return `${trimFixed(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${trimFixed(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimFixed(value / 1_000)}K`;
  return Math.round(value).toLocaleString(locale);
}

/** Byte sizes with KB/MB/GB suffixes (language-neutral units). */
export function formatBytes(locale: Locale, bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return NAN_CHAR;
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) {
    return `${formatNumber(locale, mb * 1024, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} KB`;
  }
  if (mb >= 1024) {
    return `${formatNumber(locale, mb / 1024, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} GB`;
  }
  const digits = mb < 10 ? 1 : 0;
  return `${formatNumber(locale, mb, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} MB`;
}

export interface BoundFormatters {
  locale: Locale;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatPercent: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (
    value: Date | string | number,
    options?: Intl.DateTimeFormatOptions,
  ) => string;
  formatDateTime: (value: string | Date, withSeconds?: boolean) => string;
  formatMoney: (
    amount: number,
    currency: string,
    options?: MoneyFormatOptions,
  ) => string;
  formatTokens: (value: number) => string;
  formatBytes: (bytes: number) => string;
}

/** Bind every formatter to a locale — used by `I18nProvider` (memoized). */
export function createBoundFormatters(locale: Locale): BoundFormatters {
  return {
    locale,
    formatNumber: (value, options) => formatNumber(locale, value, options),
    formatPercent: (value, options) => formatPercent(locale, value, options),
    formatDate: (value, options) => formatDate(locale, value, options),
    formatDateTime: (value, withSeconds) =>
      formatDateTime(locale, value, withSeconds),
    formatMoney: (amount, currency, options) =>
      formatMoney(locale, amount, currency, options),
    formatTokens: (value) => formatTokens(locale, value),
    formatBytes: (bytes) => formatBytes(locale, bytes),
  };
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function trimFixed(value: number): string {
  const fixed = value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2);
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}
