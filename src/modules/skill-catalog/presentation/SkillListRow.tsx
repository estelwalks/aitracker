import {
  Brain,
  Check,
  ChevronRight,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
  ShieldQuestion,
} from "lucide-react";

import { BrandIcon } from "../../../components/BrandIcon";
import { useI18n } from "../../../lib/i18n/context";
import type { SkillAssetView } from "../application/index.ts";
import { compactNumber, formatSizeBytes } from "./skill-format.ts";

/** Number of installed-agent pills shown inline before collapsing to "+N". */
const VISIBLE_AGENTS = 6;

export interface SkillCardSecurity {
  /** Number of risk findings recorded in the security history. */
  riskCount: number;
  /** Whether the skill has any security-history record at all. */
  hasHistory: boolean;
}

/**
 * 原型对齐的单行 Skill 条目（列表行而非卡片）：安全徽章 + 名称行（蒸馏
 * Brain 标识、来源、Token/体积、已装 Agent 胶囊）+ 一行描述 + 详情箭头。
 * 行内安装胶囊为只读展示，安装/同步/卸载走详情弹窗与批量操作栏。
 */
export function SkillListRow({
  skill,
  selected,
  security,
  blacklisted,
  index,
  onSelect,
  onOpen,
}: {
  skill: SkillAssetView;
  selected: boolean;
  security?: SkillCardSecurity;
  blacklisted: boolean;
  index: number;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();

  const sourceKind = skill.sourceKinds[0];
  const isDistilled = sourceKind === "unknown";
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

  const agents = skill.installedAgents;
  const visibleAgents = agents.slice(0, VISIBLE_AGENTS);
  const overflow = agents.length - visibleAgents.length;
  const selectLabel = selected
    ? t("skills.card.deselect", { name: skill.name })
    : t("skills.card.select", { name: skill.name });

  return (
    <li
      className={`group relative px-3.5 py-3 transition-colors hover:bg-surface-2/40 ${
        selected ? "bg-accent/30" : ""
      } ${index > 0 ? "border-t border-border/60" : ""}`}
    >
      <div className="flex items-start gap-3">
        {/* 选择圈：未选中时仅在悬停浮现，保持列表清爽 */}
        <button
          type="button"
          aria-label={selectLabel}
          title={selectLabel}
          onClick={onSelect}
          className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full transition-colors ${
            selected
              ? "bg-foreground text-background"
              : "bg-surface-2 text-transparent hover:text-muted-foreground"
          }`}
        >
          <Check className="size-3" />
        </button>

        {/* 安全状态徽章 */}
        <span
          title={verdictLabel}
          className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${
            verdict === "ok"
              ? "bg-ok/10 text-ok"
              : verdict === "warn"
                ? "bg-danger/10 text-danger"
                : "bg-surface-2 text-muted-foreground"
          }`}
        >
          {verdict === "ok" ? (
            <ShieldCheck className="size-4" />
          ) : verdict === "warn" ? (
            <ShieldAlert className="size-4" />
          ) : (
            <ShieldQuestion className="size-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={onOpen}
              className="tt-num truncate text-[14px] font-semibold hover:text-primary"
              title={t("skills.aria.openSkill", { name: skill.name })}
            >
              {skill.name}
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
            <span className="tt-num hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
              {compactNumber(skill.tokenEstimate)} tok ·{" "}
              {formatSizeBytes(skill.sizeBytes)}
            </span>
            {agents.length > 0 && (
              <span className="mx-1 hidden h-3.5 w-px shrink-0 bg-border sm:inline-block" />
            )}
            {visibleAgents.map((agent) => (
              <span
                key={agent}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-surface-2/70 px-1.5 py-px text-[11px] text-muted-foreground"
                title={t("skills.table.agent")}
              >
                <BrandIcon name={agent} className="size-3" />
                {agent}
              </span>
            ))}
            {overflow > 0 && (
              <span className="shrink-0 rounded-sm bg-surface-2/70 px-1.5 py-px text-[11px] text-muted-foreground">
                +{overflow}
              </span>
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
          onClick={onOpen}
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </li>
  );
}
