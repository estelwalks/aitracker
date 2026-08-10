import type { ReactNode } from "react";

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
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <h2 className="text-[13px] font-medium tracking-wide">{title}</h2>
          {action}
        </header>
      )}
      <div className={`flex-1 p-4 ${bodyClassName}`}>{children}</div>
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
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
    <div className="inline-flex rounded-sm border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[3px] px-2.5 py-1 text-xs transition-colors ${
            value === o.value
              ? "bg-primary/15 font-medium text-primary"
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
    <div className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border-strong px-6 py-12 text-center">
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
    default: "border border-border bg-surface-2 hover:border-border-strong",
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
    danger: "border border-danger/40 text-danger hover:bg-danger/10",
  } as const;
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 rounded-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
    <div className="px-4 py-3">
      <div className="tt-label">{label}</div>
      <div className="tt-num mt-1 text-lg">{value}</div>
      {hint && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
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
      className={`inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[9px] tracking-[0.08em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
