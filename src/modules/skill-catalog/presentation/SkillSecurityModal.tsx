import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { EmptyState, AITrackerButton } from "../../../components/aitracker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  getBrowserSecurityClient,
  getDesktopSecurityClient,
  type SecurityHistoryView,
  type SecurityVerdict,
} from "../../security-assessment/index";

/** Verdict → label key + tone, matching the card KPI / security page source. */
function verdictDisplay(verdict: SecurityVerdict): {
  labelKey: MessageKey;
  tone: string;
} {
  switch (verdict) {
    case "allow":
      return { labelKey: "skills.security.clean", tone: "text-ok" };
    case "warn":
      return { labelKey: "skills.security.attention", tone: "text-warn" };
    case "block":
      return { labelKey: "security.verdict.dangerous", tone: "text-danger" };
    default:
      return {
        labelKey: "skills.card.verdictUnknown",
        tone: "text-muted-foreground",
      };
  }
}

/**
 * Real security history for a single skill, driven by the same SecurityClient
 * the /security page and the card KPIs use (never the stale `lib/security`
 * SQLite-backed security history). Shows past scans with verdict and finding counts, or a
 * CTA to the security page when nothing is recorded.
 */
export function SkillSecurityModal({
  skillName,
  onClose,
}: {
  skillName: string;
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  const [entries, setEntries] = useState<readonly SecurityHistoryView[] | null>(
    null,
  );
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client =
          getDesktopSecurityClient() ?? (await getBrowserSecurityClient());
        if (client == null) {
          if (!cancelled) setEntries([]);
          return;
        }
        const history = await client.getHistory();
        if (cancelled) return;
        setEntries(
          history
            .filter((entry) => entry.skillName === skillName)
            .sort(
              (a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt),
            ),
        );
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [skillName]);

  const statusLabel = (status: SecurityHistoryView["status"]) => {
    switch (status) {
      case "failed":
        return t("security.center.status.failed");
      case "skipped":
        return t("security.center.status.skipped");
      case "cancelled":
        return t("common.cancel");
      default:
        return t("common.unknown");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            {t("skills.detail.scanSecurity")} · {skillName}
          </DialogTitle>
        </DialogHeader>

        {!loaded ? (
          <div className="grid h-40 place-items-center text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : entries == null || entries.length === 0 ? (
          <EmptyState
            icon={<ShieldAlert className="size-6" />}
            title={t("skills.security.detected")}
            desc={t("skills.detail.verifySecurity")}
            actions={
              <Link to="/security">
                <AITrackerButton>
                  {t("skills.actions.goMarket")}
                </AITrackerButton>
              </Link>
            }
          />
        ) : (
          <ul className="aitracker-rows max-h-[60vh] overflow-auto rounded-sm border border-border">
            {entries.map((entry, index) => {
              const report = entry.report;
              // Failed / skipped / cancelled scans carry no findings; render a
              // muted row so the timeline stays legible without inventing data.
              if (!report) {
                return (
                  <li
                    key={`${entry.scanId}-${index}`}
                    className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]"
                  >
                    <span className="size-1.5 shrink-0 rounded-sm bg-muted-foreground/40" />
                    <span className="aitracker-num min-w-0 flex-1 text-[11px] text-muted-foreground">
                      {format.formatDateTime(entry.finishedAt, false)}
                    </span>
                    <span className="rounded-sm border px-1.5 py-px text-[10px] text-muted-foreground">
                      {statusLabel(entry.status)}
                    </span>
                  </li>
                );
              }
              const display = verdictDisplay(report.verdict);
              return (
                <li
                  key={`${entry.scanId}-${index}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]"
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-sm ${display.tone}`}
                  />
                  <span className="aitracker-num min-w-0 flex-1 text-[11px] text-muted-foreground">
                    {format.formatDateTime(entry.finishedAt, false)}
                  </span>
                  <span className="truncate text-muted-foreground">
                    {report.findings.length > 0
                      ? `${report.findings.length} ${t("skills.security.attention")}`
                      : t("skills.security.clean")}
                  </span>
                  <span
                    className={`rounded-sm border px-1.5 py-px text-[10px] ${display.tone}`}
                  >
                    {t(display.labelKey)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter>
          <AITrackerButton variant="default" onClick={onClose}>
            {t("common.close")}
          </AITrackerButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
