import {
  Boxes,
  CircleDashed,
  Loader2,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  clampPercent,
  type SecurityScanStateView,
  type SecurityTotals,
} from "../security-view";

const phaseKeys: Record<SecurityScanStateView["status"], MessageKey> = {
  idle: "security.center.phase.idle",
  running: "security.center.phase.running",
  cancelling: "security.center.phase.cancelling",
  complete: "security.center.phase.complete",
  partial: "security.center.phase.partial",
  failed: "security.center.phase.failed",
  cancelled: "security.center.phase.cancelled",
  "model-required": "security.center.phase.modelRequired",
};

export function ScanStatus({
  state,
  totals,
  lastScan,
}: {
  state: SecurityScanStateView;
  totals: SecurityTotals;
  lastScan: string;
}) {
  const { t } = useI18n();
  const danger = state.status === "failed" || state.status === "model-required";
  const warning = state.status === "partial" || state.status === "cancelled";
  const color = danger
    ? "var(--danger)"
    : warning
      ? "var(--warn)"
      : state.status === "complete"
        ? "var(--ok)"
        : "var(--muted-foreground)";
  const active = state.status === "running" || state.status === "cancelling";
  const settled =
    state.progress.completed + state.progress.failed + state.progress.skipped;

  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-[var(--elev-1)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
        <span
          className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-medium"
          style={{ color }}
        >
          {active ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
          ) : danger || warning ? (
            <TriangleAlert className="size-3.5" strokeWidth={2} />
          ) : state.status === "complete" ? (
            <ShieldCheck className="size-3.5" strokeWidth={2} />
          ) : (
            <CircleDashed className="size-3.5" strokeWidth={2} />
          )}
          {t(phaseKeys[state.status])}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {lastScan === "—"
            ? t("security.center.status.never")
            : t("security.center.status.latest", { time: lastScan })}
        </span>
      </div>

      {active && (
        <div className="mx-5 mb-3">
          <div className="mb-1 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>
              {t("security.center.status.progress", {
                completed: settled,
                total: state.progress.queued,
              })}
            </span>
            <span>{clampPercent(state.progress.percent)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${clampPercent(state.progress.percent)}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 px-5 pb-5 sm:grid-cols-3 lg:grid-cols-6">
        <StatusCell
          icon={Boxes}
          label={t("security.center.status.discovered")}
          value={state.progress.discovered || totals.total}
        />
        <StatusCell
          icon={ShieldCheck}
          label={t("security.center.status.scanned")}
          value={
            state.progress.completed ||
            totals.safe + totals.warn + totals.danger + totals.unknown
          }
        />
        <StatusCell
          icon={ShieldCheck}
          label={t("security.center.status.safe")}
          value={totals.safe}
          color="var(--ok)"
        />
        <StatusCell
          icon={ShieldX}
          label={t("security.center.status.unsafe")}
          value={totals.warn + totals.danger + totals.unknown}
          color={
            totals.warn + totals.danger + totals.unknown
              ? "var(--danger)"
              : undefined
          }
        />
        <StatusCell
          icon={TriangleAlert}
          label={t("security.center.status.failed")}
          value={Math.max(totals.failed, state.progress.failed)}
          color={state.progress.failed ? "var(--danger)" : undefined}
        />
        <StatusCell
          icon={CircleDashed}
          label={t("security.center.status.skipped")}
          value={Math.max(totals.skipped, state.progress.skipped)}
          color={state.progress.skipped ? "var(--warn)" : undefined}
        />
      </div>
    </section>
  );
}

function StatusCell({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-lg bg-surface px-4 py-3.5 ring-1 ring-border/50">
      <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
        <Icon className="size-3" strokeWidth={1.8} />
        <span className="truncate">{label}</span>
      </div>
      <div
        className="tt-num mt-1.5 font-mono text-[20px] leading-none font-black tracking-tight"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
