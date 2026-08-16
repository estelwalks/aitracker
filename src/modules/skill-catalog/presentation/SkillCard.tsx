import { Check, ShieldAlert, ShieldCheck, Trash2, Zap } from "lucide-react";

import { StatusBadge, TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { SkillAssetView } from "../application/index.ts";
import { compactNumber, formatSizeBytes } from "./skill-format.ts";

export interface SkillCardSecurity {
  /** Number of risk findings recorded in the security history. */
  riskCount: number;
  /** Whether the skill has any security-history record at all. */
  hasHistory: boolean;
}

export function SkillCard({
  skill,
  selected,
  security,
  blacklisted,
  detectedAgentCount,
  onSelect,
  onOpen,
  onSync,
  onRemove,
}: {
  skill: SkillAssetView;
  selected: boolean;
  security?: SkillCardSecurity;
  blacklisted: boolean;
  /** Denominator for the install-coverage progress bar. */
  detectedAgentCount: number;
  onSelect: () => void;
  onOpen: () => void;
  onSync: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();

  const synced = skill.installedAgents.length;
  const denominator = Math.max(0, detectedAgentCount);
  const missing = Math.max(0, denominator - synced);
  const pct = denominator > 0 ? Math.round((synced / denominator) * 100) : 0;

  const sourceKind = skill.sourceKinds[0];
  const sourceLabel =
    sourceKind === "frontmatter"
      ? t("skills.source.frontmatter")
      : sourceKind === "market"
        ? t("skills.source.market")
        : sourceKind === "unknown"
          ? t("skills.source.unknown")
          : null;

  const verdict: "ok" | "warn" | "unknown" =
    security == null || !security.hasHistory
      ? "unknown"
      : security.riskCount > 0
        ? "warn"
        : "ok";
  const verdictLabel =
    verdict === "ok"
      ? t("skills.security.clean")
      : verdict === "warn"
        ? t("skills.security.attention")
        : t("skills.card.verdictUnknown");

  // Compact identity line under the title. The real scanner strips filesystem
  // paths (privacy), so surface the version when known, else the install-copy
  // count; omit the line entirely when neither is available.
  const subline =
    skill.versions.length > 0
      ? skill.versions[0]
      : skill.installations.length > 0
        ? t("skills.summary.installations", {
            count: skill.installations.length,
          })
        : null;

  return (
    <li
      className={`tt-panel group relative flex flex-col overflow-hidden p-3.5 transition-colors ${
        selected ? "bg-accent/40" : "hover:bg-surface-2/40"
      }`}
    >
      <div className="relative flex items-start gap-3">
        <button
          type="button"
          aria-label={
            selected
              ? t("skills.card.deselect", { name: skill.name })
              : t("skills.card.select", { name: skill.name })
          }
          onClick={onSelect}
          className={`tt-num grid size-8 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold transition-colors ${
            selected
              ? "bg-foreground text-background"
              : "bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          {selected ? (
            <Check className="size-3.5" />
          ) : (
            skill.name.slice(0, 2).toUpperCase()
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              className="tt-num truncate text-[15px] font-semibold hover:text-primary"
              title={t("skills.aria.openSkill", { name: skill.name })}
            >
              {skill.name}
            </button>
            {skill.updateStatus === "available" && (
              <StatusBadge tone="warn">
                {t("skills.update.available")}
              </StatusBadge>
            )}
          </div>
          {subline != null && (
            <div
              className="tt-num mt-0.5 truncate font-mono text-[12px] text-muted-foreground"
              title={subline}
            >
              {subline}
            </div>
          )}
        </div>

        {sourceLabel && (
          <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground">
            {sourceLabel}
          </span>
        )}
        {blacklisted && (
          <StatusBadge tone="danger">
            {t("skills.badge.blacklisted")}
          </StatusBadge>
        )}
      </div>

      {/* Reserve exactly 4 lines so the progress bar + Token/体积 row below
          stay at a fixed position regardless of description length. */}
      <p
        className="relative mt-2.5 min-h-[4lh] w-full text-[13px] leading-relaxed text-muted-foreground line-clamp-4"
        title={skill.description ?? t("skills.detail.noDescription")}
      >
        {skill.description ?? t("skills.detail.noDescription")}
      </p>

      <div
        className="relative mt-2.5 h-1 overflow-hidden rounded-full bg-surface-2"
        title={`${synced} / ${denominator}`}
      >
        <span
          className="block h-full rounded-full bg-ok/60"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="relative mt-2.5 mb-2.5 grid grid-cols-2 gap-2">
        <div>
          <div className="tt-num truncate text-[13.5px] leading-none font-semibold">
            {compactNumber(skill.tokenEstimate)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("skills.card.token")}
          </div>
        </div>
        <div>
          <div className="tt-num truncate text-[13.5px] leading-none font-semibold">
            {formatSizeBytes(skill.sizeBytes)}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {t("skills.card.size")}
          </div>
        </div>
      </div>

      <div className="relative mt-auto flex items-center gap-2 border-t border-border/70 pt-2.5">
        <span
          className={`inline-flex items-center gap-1 text-[11px] ${
            verdict === "ok"
              ? "text-ok"
              : verdict === "warn"
                ? "text-warn"
                : "text-muted-foreground"
          }`}
          title={
            security == null || !security.hasHistory
              ? t("skills.card.verdictUnknown")
              : `${t("skills.security.attention")} · ${security.riskCount}`
          }
        >
          {verdict === "ok" ? (
            <ShieldCheck className="size-3.5" />
          ) : (
            <ShieldAlert className="size-3.5" />
          )}
          {verdictLabel}
        </span>

        <div className="ml-auto flex shrink-0 gap-1.5">
          {missing > 0 ? (
            <TTButton size="sm" variant="ghost" onClick={onSync}>
              <Zap className="size-3.5" />{" "}
              {t("skills.card.syncMissing", { count: missing })}
            </TTButton>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Check className="size-3.5" /> {t("skills.card.synced")}
            </span>
          )}
          <TTButton size="sm" variant="ghost" onClick={onOpen}>
            {t("skills.actions.inspect")}
          </TTButton>
          <TTButton
            size="sm"
            variant="ghost"
            onClick={onRemove}
            title={t("skills.actions.uninstall")}
          >
            <Trash2 className="size-3.5" />
          </TTButton>
        </div>
      </div>
    </li>
  );
}
