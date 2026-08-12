import type { ReactNode } from "react";

export function SecurityCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-[var(--elev-1)]">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
          {description && (
            <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function ChipTabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-[10.5px] transition ${value === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
