import type { ReactNode } from "react";

/** Shared presentation primitives for schedule editors across product areas. */
export function ScheduleField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <div className="aitracker-text-body">{label}</div>
        {hint && (
          <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function ScheduleToggle({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
        value ? "bg-primary" : "border border-border bg-surface-2"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={value}
      aria-label={ariaLabel}
    >
      <span
        className="block size-4 rounded-full bg-background transition-transform"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

export function ScheduleSectionHeading({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-1.5 mt-1 flex items-center gap-1.5">
      {icon && (
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground">
          {icon}
        </span>
      )}
      <h3 className="aitracker-text-section-title font-semibold tracking-tight">
        {children}
      </h3>
    </div>
  );
}

export function ScheduleChip({
  active,
  disabled = false,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`aitracker-text-caption rounded-lg px-2.5 py-1.5 font-mono transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-foreground text-background"
          : "bg-surface text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
