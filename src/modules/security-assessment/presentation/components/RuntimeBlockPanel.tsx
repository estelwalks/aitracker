import {
  Activity,
  Ban,
  FileSearch,
  Layers,
  ShieldCheck,
  ShieldOff,
  ShieldX,
  Timer,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { SecurityRuntimeCapabilityView } from "../security-view";

interface CapabilityRow {
  readonly key: string;
  readonly icon: LucideIcon;
  readonly label: string;
  readonly value: string;
}

/**
 * Runtime defense panel aligned with the reference RuntimeBlockPanel design:
 * ShieldX heading, monitoring pulse, and list rows.
 *
 * The current security module is static scanning + model analysis (SecurityRuntimeCapabilityView is fixed to
 * detection-only, activeDefense=false), so this panel does not fake any runtime interception
 * Records: All list lines come from real ability contracts and real scan history, and the footer uses an honest empty state to indicate the current
 * There are no interception events.
 */
export function RuntimeBlockPanel({
  runtime,
  scannedSkills,
  riskKindCount,
}: {
  runtime: SecurityRuntimeCapabilityView | null;
  scannedSkills: number;
  riskKindCount: number;
}) {
  const { t } = useI18n();
  const monitoring = runtime?.monitorAvailable === true;

  const rows: readonly CapabilityRow[] = [
    ...(runtime
      ? [
          {
            key: "capability",
            icon: ShieldCheck,
            label: t("security.center.runtimeBlock.capabilityLabel"),
            value: t("security.center.runtimeBlock.capabilityDetectionOnly"),
          },
          {
            key: "activeDefense",
            icon: ShieldOff,
            label: t("security.center.runtimeBlock.activeDefenseLabel"),
            value: t("security.center.runtimeBlock.activeDefenseOff"),
          },
          {
            key: "monitor",
            icon: Activity,
            label: t("security.center.runtimeBlock.monitorLabel"),
            value: t("security.center.runtimeBlock.monitorOn"),
          },
          {
            key: "cancellation",
            icon: Timer,
            label: t("security.center.runtimeBlock.cancellationLabel"),
            value: t("security.center.runtimeBlock.cancellationBetween"),
          },
        ]
      : []),
    {
      key: "dimensions",
      icon: Layers,
      label: t("security.center.runtimeBlock.dimensionsLabel"),
      value: t("security.center.runtimeBlock.dimensionsValue", {
        count: riskKindCount,
      }),
    },
    {
      key: "scanned",
      icon: FileSearch,
      label: t("security.center.runtimeBlock.scannedLabel"),
      value: t("security.center.runtimeBlock.scannedValue", {
        count: scannedSkills,
      }),
    },
  ];

  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-[var(--elev-1)]">
      <header className="flex items-center gap-2 border-b border-border/60 px-5 py-3.5">
        <ShieldX
          className="size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.8}
        />
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-foreground">
          {t("security.center.runtimeBlock.title")}
        </h2>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
          <span
            className={`size-1.5 rounded-full ${
              monitoring ? "bg-ok aitracker-breathe" : "bg-border"
            }`}
          />
          {monitoring
            ? t("security.center.runtimeBlock.monitoring")
            : t("security.center.runtimeBlock.statusOff")}
        </span>
      </header>

      <ul className="divide-y divide-border/60">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-3 px-5 py-3">
            <row.icon
              className="size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.8}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
              {row.label}
            </span>
            <span className="shrink-0 text-[12.5px] font-medium">
              {row.value}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t border-border/60 bg-surface-2/40 px-5 py-4">
        <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
          <Ban className="size-3.5 shrink-0" strokeWidth={1.8} />
          {t("security.center.runtimeBlock.emptyTitle")}
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground/90">
          {t("security.center.runtimeBlock.emptyDesc")}
        </p>
      </div>
    </section>
  );
}
