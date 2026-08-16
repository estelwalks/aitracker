import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

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
        className="h-[34px] w-full rounded-full border border-transparent bg-surface-2 pr-3.5 pl-9 text-[12.5px] outline-none transition placeholder:text-muted-foreground focus:border-primary/40 focus:bg-surface"
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
  return <div className={`tt-toolbar ${className}`}>{children}</div>;
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
    <section className={`tt-panel flex flex-col ${className}`}>
      {(title || action) && (
        <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 px-5 py-2.5">
          <h2 className="text-[13px] font-medium tracking-[0.025em]">
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
    <div className="tt-page-header mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {desc && (
          <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p>
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
          className={`rounded-md px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
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
    <div className="tt-empty-state flex flex-col items-center justify-center rounded-xl px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted-foreground">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {desc && (
        <p className="mt-1 max-w-md text-[13px] text-muted-foreground">
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

export function TTButton({
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
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]"
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
    <div className="tt-stat px-4 py-3">
      <div className="tt-label">{label}</div>
      <div className="tt-num mt-1 text-lg">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

/**
 * Shared pager (V3.0 prototype style): a top divider, a localized range on the
 * left and prev/numbered/next buttons on the right. Page buttons mirror the
 * prototype exactly — square (`rounded-sm`), bordered, monospaced numerals —
 * and the window shows first/last plus the current page's neighbours.
 */
export function Pagination({
  page,
  pageCount,
  onChange,
  rangeLabel,
  prevLabel = "上一页",
  nextLabel = "下一页",
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
  const safePageCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), safePageCount);

  // Show first/last plus a window of 5 around the current page (e.g.
  // `1 2 3 4 … 4203`), so wide catalogs never collapse to a 3-button strip.
  const nums = Array.from({ length: safePageCount }, (_, i) => i + 1).filter(
    (p) =>
      p === 1 || p === safePageCount || (p >= current - 1 && p <= current + 3),
  );

  const stepButton =
    "inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface-2 px-2 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-[12px] text-muted-foreground ${className}`}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={current <= 1}
          onClick={() => onChange(current - 1)}
          aria-label={prevLabel}
          title={prevLabel}
          className={stepButton}
        >
          <ChevronLeft className="size-3" />
          {prevLabel}
        </button>
        {nums.map((p, idx) => (
          <span key={p} className="flex items-center gap-1">
            {idx > 0 && nums[idx - 1] !== p - 1 && (
              <span className="px-0.5">…</span>
            )}
            <button
              type="button"
              aria-current={p === current ? "page" : undefined}
              onClick={() => onChange(p)}
              className={`tt-num size-7 rounded-sm border text-[12px] transition-colors ${
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
          aria-label={nextLabel}
          title={nextLabel}
          className={stepButton}
        >
          {nextLabel}
          <ChevronRight className="size-3" />
        </button>
      </div>
      {rangeLabel ? (
        <span className="tt-num">{rangeLabel}</span>
      ) : (
        <span aria-hidden="true" />
      )}
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

/** 页面级指标项（与原型首页总览一致的排版）。 */
export type Metric = {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  v: ReactNode;
  sub?: ReactNode;
  hint?: string;
  color?: string;
  right?: ReactNode;
};

/** 页面吸顶标题条：左侧标题 + 概要数字，右侧操作区。 */
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
        <span className="text-[13px] font-semibold tracking-tight">
          {title}
        </span>
        {summary && (
          <span className="tt-num truncate font-mono text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** 原型首页同款指标网格。 */
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
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
            {m.icon && <m.icon className="size-3" strokeWidth={1.8} />}
            <span className="truncate">{m.label}</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className="tt-num min-w-0 flex-1 truncate font-mono text-[22px] leading-none font-black tracking-tight"
              style={m.color ? { color: m.color } : undefined}
            >
              {m.v}
            </span>
            {m.right}
          </div>
          {m.sub && (
            <div
              className="mt-1 truncate font-mono text-[10px] text-muted-foreground"
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

/** 原型首页同款 pill 切换器（可带图标与品牌色）。 */
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
      className={`tt-xscroll flex items-center gap-2 overflow-x-auto pb-1 ${className}`}
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

/** 原型首页同款内容卡片（无线框、圆角、卡片底色）。 */
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
            <h2 className="truncate text-[13px] font-semibold tracking-tight">
              {title}
            </h2>
            {desc && (
              <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
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
