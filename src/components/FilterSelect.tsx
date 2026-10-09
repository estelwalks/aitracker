import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface FilterSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface FilterSelectProps<T extends string> {
  readonly value: T;
  readonly options: readonly FilterSelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel: string;
  readonly className?: string;
}

/** Compact, consistent filter menu used instead of browser-native selects. */
export function FilterSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: FilterSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-[30px] min-w-[112px] items-center justify-between gap-2 rounded-md border border-border bg-surface-2/70 px-2.5 text-[12px] text-foreground transition-colors hover:border-primary/50 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute top-[calc(100%+6px)] right-0 z-50 min-w-full overflow-hidden rounded-lg border border-border bg-card p-1 shadow-xl shadow-black/20"
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[12px] whitespace-nowrap transition-colors ${
                  active
                    ? "bg-primary/12 font-medium text-primary"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span>{option.label}</span>
                {active ? <Check className="size-3.5 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
