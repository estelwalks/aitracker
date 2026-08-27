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
 * 运行时防御面板（对齐 V3.0 原型 RuntimeBlockPanel 视觉：ShieldX 标题 +
 * 「监控中」呼吸点 + 列表行）。
 *
 * 当前安全模块是静态扫描 + 模型分析（SecurityRuntimeCapabilityView 固定为
 * detection-only、activeDefense=false），因此本面板**不伪造**任何运行时拦截
 * 记录：列表行全部来自真实能力契约与真实扫描历史，页脚用诚实空态说明当前
 * 没有任何拦截事件。
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
