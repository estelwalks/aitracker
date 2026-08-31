import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { useI18n } from "../lib/i18n/context";
import { paginationWindow } from "../lib/pagination";

/** Shared compact input for module toolbars and data views. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = "w-full sm:w-72",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="aitracker-text-body-sm h-[34px] w-full rounded-full border border-transparent bg-surface-2 pr-3.5 pl-9 outline-none transition placeholder:text-muted-foreground focus:border-primary/40 focus:bg-surface"
      />
    </div>
  );
}

/** A consistent control rail for module filters, search, and actions. */
export function Toolbar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`aitracker-toolbar ${className}`}>{children}</div>;
}

export function Panel({
  title,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`aitracker-panel flex flex-col ${className}`}>
      {(title || action) && (
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 px-5 py-2.5">
          <h2 className="aitracker-text-section-title font-medium tracking-[0.025em]">
            {title}
          </h2>
          {action}
        </header>
      )}
      <div className={`flex-1 p-5 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children?: ReactNode;
}) {
  return (
    <div className="aitracker-page-header mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="aitracker-text-page-title font-semibold tracking-tight">
          {title}
        </h1>
        {desc && (
          <p className="aitracker-text-body mt-0.5 text-muted-foreground">
            {desc}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2/80 p-1 shadow-inner shadow-black/10">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`aitracker-text-control min-h-[var(--aitracker-control-height)] rounded-md px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
            value === o.value
              ? "bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  desc,
  actions,
  icon,
}: {
  title: string;
  desc?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="aitracker-empty-state flex flex-col items-center justify-center rounded-xl px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {desc && (
        <p className="aitracker-text-body mt-1 max-w-md text-muted-foreground">
          {desc}
        </p>
      )}
      {actions && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function AITrackerButton({
  children,
  onClick,
  variant = "default",
  size = "md",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const variants = {
    default: "bg-surface-2 hover:bg-accent",
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
    danger: "bg-danger/10 text-danger hover:bg-danger/15",
  } as const;
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 ${
        size === "sm"
          ? "min-h-[var(--aitracker-control-height-sm)] px-2.5 aitracker-text-control"
          : "min-h-[var(--aitracker-control-height)] px-3.5 aitracker-text-body"
      } ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Dot({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${className}`}
    />
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="aitracker-stat px-4 py-3">
      <div className="aitracker-label">{label}</div>
      <div className="aitracker-num aitracker-text-metric mt-1">{value}</div>
      {hint && (
        <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * Shared pager (reference design): a top divider, a localized range on the
 * left and prev/numbered/next buttons anchored at the bottom-right. Numbered
 * buttons grow with their content, and the compact window keeps huge catalogs
 * inside the card without losing first/last/current context.
 */
export function Pagination({
  page,
  pageCount,
  onChange,
  rangeLabel,
  prevLabel,
  nextLabel,
  className = "",
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  rangeLabel?: string;
  prevLabel?: string;
  nextLabel?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const resolvedPrev = prevLabel ?? t("common.pagination.previous");
  const resolvedNext = nextLabel ?? t("common.pagination.next");
  const safePageCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safePageCount);

  const nums = paginationWindow(current, safePageCount);

  const stepButton =
    "aitracker-text-control inline-flex min-h-[var(--aitracker-control-height)] items-center justify-center gap-1.5 rounded-[6px] border border-border bg-surface-2 px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      className={`aitracker-text-body-sm flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-muted-foreground ${className}`}
    >
      {rangeLabel ? <span className="aitracker-num">{rangeLabel}</span> : null}
      <div className="aitracker-pagination-controls ml-auto flex max-w-full items-center justify-end gap-1 overflow-x-auto pb-px">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
          aria-label={resolvedPrev}
          title={resolvedPrev}
          className={stepButton}
        >
          <ChevronLeft className="size-4 shrink-0" />
          <span className="hidden sm:inline">{resolvedPrev}</span>
        </button>
        {nums.map((p, idx) => (
          <span key={p} className="flex shrink-0 items-center gap-1">
            {idx > 0 && nums[idx - 1] !== p - 1 && (
              <span className="shrink-0 px-0.5">…</span>
            )}
            <button
              type="button"
              aria-current={p === current ? "page" : undefined}
              onClick={() => onChange(p)}
              className={`aitracker-num aitracker-text-body-sm h-[var(--aitracker-control-height)] min-w-[var(--aitracker-control-height)] shrink-0 rounded-[6px] border px-2 transition-colors ${
                p === current
                  ? "border-ok bg-ok/15 text-ok"
                  : "border-border hover:text-foreground"
              }`}
            >
              {p}
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={current >= safePageCount}
          onClick={() => onChange(current + 1)}
          aria-label={resolvedNext}
          title={resolvedNext}
          className={stepButton}
        >
          <span className="hidden sm:inline">{resolvedNext}</span>
          <ChevronRight className="size-4 shrink-0" />
        </button>
      </div>
    </div>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "primary" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-border text-muted-foreground",
    primary: "border-primary/30 text-primary",
    ok: "border-ok/30 text-ok",
    warn: "border-warn/30 text-warn",
    danger: "border-danger/30 text-danger",
  } as const;
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[9px] tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** Page-level indicator items (layout consistent with the prototype homepage overview). */
export type Metric = {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  v: ReactNode;
  sub?: ReactNode;
  hint?: string;
  color?: string;
  right?: ReactNode;
};

/** Title bar at the top of the page: title + summary number on the left, operation area on the right. */
export function PageBar({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-14 z-30 -mx-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 bg-background px-4 py-2.5 md:-mx-8 md:px-8">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="aitracker-text-page-title font-semibold tracking-tight">
          {title}
        </h1>
        {summary && (
          <span className="aitracker-num aitracker-text-caption truncate font-mono text-muted-foreground">
            {summary}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** The same indicator grid on the prototype homepage. */
export function MetricGrid({
  items,
  className = "",
}: {
  items: Metric[];
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${className}`}
    >
      {items.map((m) => (
        <div
          key={m.label}
          className="group rounded-xl bg-card px-4 py-3.5 ring-1 ring-border/50 transition-colors hover:bg-surface-2"
        >
          <div className="flex items-center gap-1.5 text-[10px] tracking-[0.08em] text-foreground/75 uppercase">
            {m.icon && <m.icon className="size-4" strokeWidth={1.8} />}
            <span className="truncate">{m.label}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className="aitracker-num aitracker-text-metric min-w-0 flex-1 truncate font-mono leading-none font-black tracking-tight"
              style={m.color ? { color: m.color } : undefined}
            >
              {m.v}
            </span>
            {m.right}
          </div>
          {m.sub && (
            <div
              className="mt-1 truncate text-[10px] text-muted-foreground/70"
              title={m.hint ?? undefined}
            >
              {m.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The same pill switcher on the prototype homepage (can have icons and brand colors). */
export function ChipTabs<T extends string>({
  value,
  onChange,
  options,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: {
    value: T;
    label: ReactNode;
    icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
    color?: string;
  }[];
  className?: string;
}) {
  return (
    <div
      className={`aitracker-xscroll flex items-center gap-2 overflow-x-auto pb-1 ${className}`}
    >
      {options.map((o) => {
        const active = value === o.value;
        const color = o.color;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] font-medium transition-colors ${
              active && !color
                ? "bg-foreground text-background"
                : "bg-card hover:bg-surface-2"
            }`}
            style={
              active && color
                ? {
                    background: `${color}22`,
                    color,
                    boxShadow: `inset 0 0 0 1.5px ${color}`,
                  }
                : undefined
            }
          >
            {o.icon && <o.icon className="size-4" strokeWidth={1.8} />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The same content card on the prototype homepage (no frame, rounded corners, card background color). */
export function Card({
  title,
  desc,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl bg-card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="aitracker-text-body truncate font-semibold tracking-tight">
              {title}
            </h2>
            {desc && (
              <p className="aitracker-text-caption mt-0.5 truncate text-muted-foreground/70">
                {desc}
              </p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
