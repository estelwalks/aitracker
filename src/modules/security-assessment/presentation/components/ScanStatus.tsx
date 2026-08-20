import {
  Boxes,
  ChevronDown,
  History,
  Layers,
  Loader2,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useState } from "react";

import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import {
  clampPercent,
  isScanActive,
  relativeTimeParts,
  type SecurityRiskKind,
  type SecurityScanStateView,
  type SecurityTotals,
} from "../security-view";

const riskKindKeys: Record<SecurityRiskKind, MessageKey> = {
  remote_execution: "security.center.risk.remote_execution",
  command_injection: "security.center.risk.command_injection",
  data_exfiltration: "security.center.risk.data_exfiltration",
  secret_access: "security.center.risk.secret_access",
  persistence: "security.center.risk.persistence",
  destructive: "security.center.risk.destructive",
  obfuscation: "security.center.risk.obfuscation",
  privilege_escalation: "security.center.risk.privilege_escalation",
  sensitive_file_access: "security.center.risk.sensitive_file_access",
  network_abuse: "security.center.risk.network_abuse",
  prompt_injection: "security.center.risk.prompt_injection",
};

/** 11 个安全维度的说明文案（与 V3.0 原型 securityDimensions.desc 一致）。 */
const dimensionDescKeys: Record<SecurityRiskKind, MessageKey> = {
  remote_execution: "security.center.dimensionDesc.remote_execution",
  command_injection: "security.center.dimensionDesc.command_injection",
  data_exfiltration: "security.center.dimensionDesc.data_exfiltration",
  secret_access: "security.center.dimensionDesc.secret_access",
  persistence: "security.center.dimensionDesc.persistence",
  destructive: "security.center.dimensionDesc.destructive",
  obfuscation: "security.center.dimensionDesc.obfuscation",
  privilege_escalation: "security.center.dimensionDesc.privilege_escalation",
  sensitive_file_access: "security.center.dimensionDesc.sensitive_file_access",
  network_abuse: "security.center.dimensionDesc.network_abuse",
  prompt_injection: "security.center.dimensionDesc.prompt_injection",
};

export type ScanStatusNav = "all" | "history" | "safe" | "unsafe";

function agoText(iso: string, t: ReturnType<typeof useI18n>["t"]): string {
  const parts = relativeTimeParts(iso, Date.now());
  if (parts.unit === "just") return t("security.center.status.agoJust");
  if (parts.unit === "minute")
    return t("security.center.status.agoMinutes", { count: parts.value });
  if (parts.unit === "hour")
    return t("security.center.status.agoHours", { count: parts.value });
  return t("security.center.status.agoDays", { count: parts.value });
}

/**
 * 全局安全统计：与 V3.0 原型 ScanStatus 对齐的 4 格可点击统计卡。
 *
 * 已扫描 / 累计扫描 / 安全 / 不安全 四格可点击跳转；底部可展开 11 个
 * 安全维度。当真实运行时能力为「仅检测」时，底部低调展示真实状态徽标，
 * 不渲染任何防御/拦截内容。
 */
export function ScanStatus({
  state,
  totals,
  scanCount,
  dimensions,
  latestFinishedAt,
  riskKinds,
  onGo,
}: {
  state: SecurityScanStateView;
  totals: SecurityTotals;
  scanCount: number;
  dimensions: number;
  latestFinishedAt?: string | null;
  riskKinds: readonly SecurityRiskKind[];
  onGo: (key: ScanStatusNav) => void;
}) {
  const { t, format } = useI18n();
  const [dimsOpen, setDimsOpen] = useState(false);
  const active = isScanActive(state.status);
  const unsafe = totals.warn + totals.danger + totals.unknown + totals.failed;
  const settled =
    state.progress.completed + state.progress.failed + state.progress.skipped;

  return (
    <section className="overflow-hidden rounded-xl bg-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pt-4">
        <h2 className="text-[13px] font-semibold tracking-tight">
          {t("security.center.status.title")}
        </h2>
        <div className="ml-auto flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {active ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {t("security.center.status.scanning")}
            </>
          ) : latestFinishedAt ? (
            t("security.center.status.latestAgo", {
              ago: agoText(latestFinishedAt, t),
              time: format.formatDateTime(latestFinishedAt, false),
            })
          ) : (
            t("security.center.status.never")
          )}
        </div>
      </div>

      {active && (
        <div className="mx-5 mt-3">
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

      <div className="mt-3 grid grid-cols-2 gap-3 px-5 pb-5 lg:grid-cols-4">
        <Cell
          icon={Boxes}
          label={t("security.center.status.scannedLabel")}
          value={`${format.formatNumber(totals.total)} ${t(
            "security.center.metrics.unit",
          )}`}
          hint={t("security.center.status.navAll")}
          onClick={() => onGo("all")}
        />
        <Cell
          icon={History}
          label={t("security.center.status.scanCountLabel")}
          value={`${format.formatNumber(scanCount)} ${t(
            "security.center.status.scanCountUnit",
          )}`}
          hint={t("security.center.status.navHistory")}
          onClick={() => onGo("history")}
        />
        <Cell
          icon={ShieldCheck}
          label={t("security.center.metrics.safe")}
          value={`${format.formatNumber(totals.safe)} ${t(
            "security.center.metrics.unit",
          )}`}
          hint={t("security.center.status.navSafe")}
          color="var(--ok)"
          onClick={() => onGo("safe")}
        />
        <Cell
          icon={ShieldX}
          label={t("security.center.status.unsafeLabel")}
          value={`${format.formatNumber(unsafe)} ${t(
            "security.center.metrics.unit",
          )}`}
          hint={t("security.center.status.navUnsafe")}
          color={unsafe ? "var(--danger)" : undefined}
          onClick={() => onGo("unsafe")}
        />
      </div>

      <div>
        <button
          type="button"
          onClick={() => setDimsOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-5 py-3 text-left font-mono text-[11px] text-muted-foreground transition-colors hover:bg-surface-2"
          style={{ boxShadow: "inset 0 1px 0 var(--rowline)" }}
        >
          <Layers className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 flex-1 truncate">
            {t("security.center.status.dimensionsFooter", { dimensions })}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 transition-transform ${
              dimsOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {dimsOpen && (
          <div className="grid gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
            {riskKinds.map((kind, index) => (
              <div key={kind} className="rounded-lg bg-surface px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="tt-num font-mono text-[10px] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                    {t(riskKindKeys[kind])}
                  </span>
                  <span className="shrink-0 font-mono text-[9.5px] text-muted-foreground/70">
                    {kind}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-[10.5px] text-muted-foreground/80">
                  {t(dimensionDescKeys[kind])}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Cell({
  icon: Icon,
  label,
  value,
  hint,
  color,
  onClick,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
  hint?: string;
  color?: string;
  onClick?: () => void;
}) {
  const base = "rounded-xl bg-surface px-4 py-3.5 text-left";
  const inner = (
    <>
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
      {hint && (
        <div className="mt-1 truncate font-mono text-[10px] text-primary">
          {hint} {onClick ? "→" : ""}
        </div>
      )}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} cursor-pointer transition-colors hover:bg-surface-2`}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}
