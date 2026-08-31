import { EyeOff, HardDrive, Lock, UserCheck } from "lucide-react";

import { useI18n } from "../lib/i18n/context";

/**
 * Global privacy commitment bar: a permanent thin bar at the bottom, which does not occupy the page module space.
 * Hovering expands the three full privacy commitments from the reference design.
 */
export function PrivacyStrip() {
  const { t } = useI18n();
  const items = [
    {
      icon: HardDrive,
      title: t("privacy.local.title"),
      desc: t("privacy.local.desc"),
    },
    {
      icon: EyeOff,
      title: t("privacy.ownership.title"),
      desc: t("privacy.ownership.desc"),
    },
    {
      icon: UserCheck,
      title: t("privacy.account.title"),
      desc: t("privacy.account.desc"),
    },
  ];
  return (
    <div className="group/pv relative">
      {/* Hover to expand details */}
      <div className="pointer-events-none absolute bottom-full left-4 mb-2 w-[min(620px,calc(100vw-2rem))] origin-bottom-left scale-95 opacity-0 transition-all duration-150 group-hover/pv:pointer-events-auto group-hover/pv:scale-100 group-hover/pv:opacity-100">
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border shadow-lg sm:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="flex items-start gap-2.5 bg-card px-3 py-2.5"
            >
              <item.icon
                className="mt-0.5 size-3.5 shrink-0 text-ok"
                strokeWidth={1.8}
              />
              <div className="min-w-0">
                <div className="truncate text-[12px] font-semibold">
                  {item.title}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted-foreground">
                  {item.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Thin strip body */}
      <div className="flex h-7 items-center gap-2 overflow-hidden border-t border-border bg-background/95 px-4 backdrop-blur md:px-8">
        <Lock className="size-3 shrink-0 text-ok" strokeWidth={2} />
        <span className="truncate font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
          {items.map((item) => item.title).join("  ·  ")}
        </span>
      </div>
    </div>
  );
}
