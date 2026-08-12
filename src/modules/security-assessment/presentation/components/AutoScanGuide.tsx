import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Eye,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { SecurityRuntimeCapabilityView } from "../security-view";

export function AutoScanGuide({
  runtime,
}: {
  runtime: SecurityRuntimeCapabilityView | null;
}) {
  const { t } = useI18n();
  const available = runtime?.monitorAvailable ?? false;
  if (!available) {
    return (
      <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)]">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
            <ShieldOff className="size-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[13px] font-semibold tracking-tight">
                {t("security.center.autoScan.title")}
              </h3>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                {t("security.center.autoScan.unavailable")}
              </span>
            </div>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">
              {t("security.center.autoScan.unavailableDesc")}
            </p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="rounded-2xl bg-card p-4 shadow-[var(--elev-1)]">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-xl ${available ? "bg-ok/15 text-ok" : "bg-surface-2 text-muted-foreground"}`}
        >
          <CalendarClock className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold tracking-tight">
              {t("security.center.autoScan.title")}
            </h3>
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
              {t("security.center.autoScan.quickOnly")}
            </span>
          </div>
          <p className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {t("security.center.autoScan.desc")}
          </p>
        </div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] hover:opacity-80"
        >
          {t("security.center.autoScan.settings")}{" "}
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-3">
        {[
          {
            icon: AlarmClock,
            title: t("security.center.autoScan.stepEnable"),
            desc: t("security.center.autoScan.stepEnableDesc"),
          },
          {
            icon: ShieldCheck,
            title: t("security.center.autoScan.stepMode"),
            desc: t("security.center.autoScan.stepModeDesc"),
          },
          {
            icon: Eye,
            title: t("security.center.autoScan.stepReview"),
            desc: t("security.center.autoScan.stepReviewDesc"),
          },
        ].map((step) => (
          <li
            key={step.title}
            className="flex items-start gap-2 rounded-xl bg-surface px-3 py-2.5"
          >
            <step.icon
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">
                {step.title}
              </span>
              <span className="block text-[10.5px] text-muted-foreground">
                {step.desc}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
