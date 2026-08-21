import { Check, ChevronDown, ChevronUp, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { BrandIcon } from "../../../components/BrandIcon";
import { useI18n } from "../../../lib/i18n/context";

/**
 * Agent 安装条（V3.0 原型样式）：直接在列表行/卡片内展示全部可安装 Agent。
 * 视觉与原型完全一致——点击单个 Agent 立即安装 / 卸载（开关由父级接到真实
 * 后端），「全选 / 全不选」（Plus）用于批量。inline 变体：紧跟在 Skill 名称
 * 之后，一排紧凑图标钮，无计数话术；溢出时折叠成「展开更多」。
 *
 * 两种交互模式：
 * - 开关模式（onToggle）：点击 Agent 立即安装/卸载，安装中显示 spinner。
 * - 选择模式（onSelect）：勾选安装目标；selected 传数组时支持多选，
 *   onSetAll + allSelected 提供全选/全不选。
 */
export function AgentInstallBar({
  agents,
  installed,
  onToggle,
  onSetAll,
  selected,
  onSelect,
  disabled = false,
  pendingAgents,
  allSelected,
  cols = 2,
  rows = 2,
  inline = false,
  inlineVisible = 4,
}: {
  agents: readonly string[];
  installed: Readonly<Record<string, boolean>>;
  /** 点击单个 Agent：next=true 安装、false 卸载（父级接真实安装流）。 */
  onToggle?: (agent: string, next: boolean) => void;
  /** 全选 / 全不选（inline 显示为 Plus 圆角钮，网格显示为右上角链接）。 */
  onSetAll?: (next: boolean) => void;
  /** 选择安装目标模式：单个高亮（string）或多选勾选（数组）。 */
  selected?: string | readonly string[] | null;
  /** 选择安装目标模式：点击 Agent 时切换选中（多选由父级维护集合）。 */
  onSelect?: (agent: string) => void;
  /** 安装/卸载进行中的 Agent（该 Agent 显示 loading 并禁用）。 */
  pendingAgents?: ReadonlySet<string> | null;
  /** 多选模式下全选状态（未提供时按 installed 推导 allOn）。 */
  allSelected?: boolean | null;
  /** 安装进行中禁用整个条。 */
  disabled?: boolean;
  cols?: number;
  rows?: number;
  inline?: boolean;
  inlineVisible?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const onCount = agents.filter((a) => installed[a]).length;
  const allOn = onCount === agents.length && agents.length > 0;
  const multi = Array.isArray(selected);
  const selectedSet = multi ? new Set(selected as readonly string[]) : null;
  const isAgentSelected = (agent: string): boolean =>
    multi ? (selectedSet?.has(agent) ?? false) : selected === agent;
  const isPending = (agent: string): boolean =>
    pendingAgents?.has(agent) ?? false;
  const toggleAllOn = allSelected ?? allOn;

  const handleClick = (agent: string, on: boolean) => {
    if (disabled || isPending(agent)) return;
    if (onSelect) {
      onSelect(agent);
      return;
    }
    if (!onToggle) return;
    onToggle(agent, !on);
  };

  const spinner = <Loader2 className="size-[18px] animate-spin" />;

  if (inline) {
    const overflow = agents.length > inlineVisible;
    const shown = open || !overflow ? agents : agents.slice(0, inlineVisible);
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {shown.map((agent) => {
          const on = !!installed[agent];
          const pending = isPending(agent);
          return (
            <button
              key={agent}
              type="button"
              aria-pressed={on}
              disabled={disabled || pending}
              aria-label={
                pending
                  ? t("common.loading")
                  : on
                    ? t("market.install.uninstallFrom", { agent })
                    : t("market.install.to", { agent })
              }
              title={
                pending
                  ? t("common.loading")
                  : on
                    ? t("market.install.installedAt", { agent })
                    : t("market.install.to", { agent })
              }
              onClick={() => handleClick(agent, on)}
              className={`grid size-8 shrink-0 place-items-center rounded-md border transition-all ${
                on
                  ? "border-transparent bg-white/70 text-primary"
                  : "border-border/60 bg-white/70 text-muted-foreground/40 grayscale hover:border-border hover:text-muted-foreground hover:grayscale-0"
              }`}
            >
              {pending ? (
                spinner
              ) : (
                <BrandIcon name={agent} className="size-[18px]" />
              )}
            </button>
          );
        })}
        {overflow && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={
              open ? t("nav.collapse") : t("market.install.expandMore")
            }
            title={
              open
                ? t("nav.collapse")
                : t("market.install.expandMore", {
                    count: agents.length - inlineVisible,
                  })
            }
            className="shrink-0 rounded-md border border-border bg-surface-2/60 px-1.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
          </button>
        )}
        {onSetAll && (
          <button
            type="button"
            onClick={() => onSetAll(!toggleAllOn)}
            aria-label={
              toggleAllOn
                ? t("market.install.clearAll")
                : t("market.install.selectAll")
            }
            title={
              toggleAllOn
                ? t("market.install.clearAll")
                : t("market.install.selectAll")
            }
            className={`grid size-8 shrink-0 place-items-center rounded-md border transition-colors ${
              toggleAllOn
                ? "border-primary/45 bg-primary/12 text-primary"
                : "border-border bg-surface-2/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Plus className="size-4" />
          </button>
        )}
      </span>
    );
  }

  const limit = cols * rows;
  const overflow = agents.length > limit;
  const shown = open || !overflow ? agents : agents.slice(0, limit);

  return (
    <div className="min-w-0">
      {onSetAll && (
        <div className="mb-1.5 flex items-center">
          <button
            type="button"
            onClick={() => onSetAll(!toggleAllOn)}
            className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-primary"
          >
            {toggleAllOn
              ? t("market.install.clearAll")
              : t("market.install.selectAll")}
          </button>
        </div>
      )}

      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
      >
        {shown.map((agent) => {
          const on = !!installed[agent];
          const isSelected = isAgentSelected(agent);
          const pending = isPending(agent);
          return (
            <button
              key={agent}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled || pending}
              title={
                pending
                  ? t("common.loading")
                  : on
                    ? t("market.install.installedAt", { agent })
                    : isSelected
                      ? t("market.install.target")
                      : t("market.install.to", { agent })
              }
              onClick={() => handleClick(agent, on)}
              className={`flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                isSelected
                  ? "border-ok/70 bg-white text-neutral-900"
                  : on
                    ? "border-transparent bg-ok/25 text-foreground"
                    : "border-border bg-surface-2 text-muted-foreground hover:border-ok/40 hover:text-foreground"
              }`}
            >
              {pending ? (
                spinner
              ) : (
                <BrandIcon name={agent} className="size-[18px] shrink-0" />
              )}
              <span className="truncate">{agent}</span>
              {on && !isSelected && (
                <Check className="ml-auto size-4 shrink-0 text-ok" />
              )}
              {multi && isSelected && (
                <Check className="ml-auto size-4 shrink-0 text-ok" />
              )}
            </button>
          );
        })}
      </div>

      {overflow && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? (
            <>
              <ChevronUp className="size-3" /> {t("nav.collapse")}
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />{" "}
              {t("market.install.expandAll", { count: agents.length })}
            </>
          )}
        </button>
      )}
    </div>
  );
}
