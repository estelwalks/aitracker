import {
  Brain,
  Check,
  ChevronRight,
  Shield,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
} from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import { AgentInstallBar } from "../../skill-distribution/index.ts";
import type { SkillAgent } from "../query.ts";
import type { SkillAssetView } from "../application/index.ts";
import { compactNumber, formatSizeBytes } from "./skill-format.ts";

export interface SkillCardSecurity {
  /** Number of risk findings recorded in the security history. */
  riskCount: number;
  /** Whether the skill has any security-history record at all. */
  hasHistory: boolean;
}

/**
 * Archetype aligned single line skill entry (list line not card): security badge + name line (distilled
 * Brain logo, source, Token/volume, installed Agent installation bar) + one-line description + detail arrow.
 * The inline installation bar is the prototype AgentInstallBar: the icon button is lit = installed, gray = can be installed, click to install/
 * Uninstall, Plus button select all/unselect all - interactively connected to the real backend (SkillsPage provides callback).
 */
export function SkillListRow({
  skill,
  selected,
  security,
  blacklisted,
  index,
  availableAgents,
  pendingAgents,
  onToggleAgent,
  onSelect,
  onOpen,
}: {
  skill: SkillAssetView;
  selected: boolean;
  security?: SkillCardSecurity;
  blacklisted: boolean;
  index: number;
  /** The client's installable Agents (prototype availableAgents) have been detected locally. */
  availableAgents: readonly SkillAgent[];
  /** Installation/uninstallation of an agent in progress (the agent shows loading and is disabled). */
  pendingAgents?: ReadonlySet<string> | null;
  /** Click a single Agent to install/uninstall. The agent is passed as a string, consistent with AgentInstallBar. */
  onToggleAgent: (agent: string, next: boolean) => void;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  const sourceKind = skill.sourceKinds[0];
  const isDistilled = skill.isDistilled;
  const displayName = skill.displayName;
  const sourceLabel =
    sourceKind === "frontmatter"
      ? t("skills.source.frontmatter")
      : sourceKind === "market"
        ? t("skills.source.market")
        : sourceKind === "unknown"
          ? t("skills.source.unknown")
          : null;

  const verdict: "ok" | "unsafe" | "unknown" =
    security == null || !security.hasHistory
      ? "unknown"
      : security.riskCount > 0
        ? "unsafe"
        : "ok";
  const verdictLabel =
    verdict === "ok"
      ? t("skills.security.clean")
      : verdict === "unsafe"
        ? t("skills.security.unsafe")
        : t("skills.security.pending");

  const installedMap = Object.fromEntries(
    skill.installedAgents.map((agent) => [agent, true]),
  );
  const selectLabel = selected
    ? t("skills.card.deselect", { name: displayName })
    : t("skills.card.select", { name: displayName });

  return (
    <li
      onClick={onSelect}
      className={`group relative cursor-pointer px-3.5 py-3 transition-colors hover:bg-surface-2/40 ${
        selected ? "bg-accent/30" : ""
      } ${index > 0 ? "[box-shadow:inset_0_1px_0_var(--rowline)]" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* 选择圈：未选中时仅在悬停浮现，保持列表清爽 */}
        <button
          type="button"
          aria-label={selectLabel}
          title={selectLabel}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
          className={`grid size-5 shrink-0 place-items-center self-center rounded-[6px] border transition-colors ${
            selected
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-surface-2 text-transparent hover:text-muted-foreground"
          }`}
        >
          <Check className="size-2.5" />
        </button>

        {/* 安全状态胶囊：图标 + 文字横向排列，未扫描为中性待扫描态 */}
        <span
          title={verdictLabel}
          className={`inline-flex shrink-0 items-center gap-1.5 self-center rounded-full border px-2.5 py-1.5 text-[11px] leading-none ${
            verdict === "ok"
              ? "border-ok/25 bg-ok/10 text-ok"
              : verdict === "unsafe"
                ? "border-danger/25 bg-danger/10 text-danger"
                : "border-border bg-surface-2 text-muted-foreground"
          }`}
        >
          {verdict === "ok" ? (
            <ShieldCheck className="size-3.5" />
          ) : verdict === "unsafe" ? (
            <ShieldAlert className="size-3.5" />
          ) : (
            <Shield className="size-3.5" />
          )}
          {verdict === "ok"
            ? t("skills.security.clean")
            : verdict === "unsafe"
              ? t("skills.security.unsafe")
              : t("skills.security.pending")}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onOpen();
              }}
              className="aitracker-num truncate text-[14px] font-semibold hover:text-primary"
              title={t("skills.aria.openSkill", { name: displayName })}
            >
              {displayName}
            </button>
            {isDistilled && (
              <Brain className="size-3.5 shrink-0 text-primary" />
            )}
            {blacklisted && (
              <span
                className="shrink-0 text-danger"
                title={t("skills.badge.blacklisted")}
              >
                <ShieldBan className="size-3.5" />
              </span>
            )}
            {sourceLabel && (
              <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground">
                {sourceLabel}
              </span>
            )}
            <span className="aitracker-num hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
              {compactNumber(skill.tokenEstimate)} tok ·{" "}
              {formatSizeBytes(skill.sizeBytes)}
            </span>
            {availableAgents.length > 0 && (
              <>
                <span className="mx-1 hidden h-3.5 w-px shrink-0 bg-border sm:inline-block" />
                <span
                  className="ml-auto flex items-center"
                  onClick={(event) => event.stopPropagation()}
                >
                  <AgentInstallBar
                    agents={availableAgents}
                    installed={installedMap}
                    onToggle={onToggleAgent}
                    pendingAgents={pendingAgents}
                    inline
                    inlineVisible={8}
                  />
                </span>
              </>
            )}
          </div>

          <p
            className="mt-1 line-clamp-1 text-[12.5px] leading-relaxed text-muted-foreground"
            title={skill.description ?? t("skills.detail.noDescription")}
          >
            {skill.description ?? t("skills.detail.noDescription")}
          </p>
        </div>

        <button
          type="button"
          aria-label={t("skills.actions.inspect")}
          title={t("skills.actions.inspect")}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </li>
  );
}
