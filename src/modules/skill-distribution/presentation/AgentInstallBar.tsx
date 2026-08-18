import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

import { BrandIcon } from "../../../components/BrandIcon";
import { useI18n } from "../../../lib/i18n/context";

/**
 * Agent 安装条（V3.0 原型样式）：直接在列表行内展示全部可安装 Agent。
 * 视觉与原型完全一致；交互接真实安装流——点击「未安装」的 Agent 触发
 * `onToggle`（由父级打开安装确认弹窗并预选该 Agent）；已安装的 Agent 呈
 * 点亮态，点击无操作（真实后端不提供一键卸载）。
 * `selected`/`onSelect` 提供「选择安装目标」模式（详情弹窗内使用）。
 * inline 变体：紧跟在 Skill 名称之后，一排紧凑胶囊，无计数话术。
 */
export function AgentInstallBar({
  agents,
  installed,
  onToggle,
  selected,
  onSelect,
  disabled = false,
  cols = 2,
  rows = 2,
  inline = false,
  inlineVisible = 4,
}: {
  agents: readonly string[];
  installed: Readonly<Record<string, boolean>>;
  /** 点击某个未安装 Agent：打开安装流程（预选该 Agent）。 */
  onToggle?: (agent: string) => void;
  /** 选择安装目标模式：当前高亮的 Agent。 */
  selected?: string | null;
  /** 选择安装目标模式：点击 Agent 切换选中。 */
  onSelect?: (agent: string) => void;
  /** 安装进行中禁用整个条。 */
  disabled?: boolean;
  cols?: number;
  rows?: number;
  inline?: boolean;
  inlineVisible?: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const handleClick = (agent: string, on: boolean) => {
    if (disabled) return;
    if (onSelect) {
      onSelect(agent);
      return;
    }
    // 已安装：无卸载入口，点击不产生副作用。
    if (on || !onToggle) return;
    onToggle(agent);
  };

  if (inline) {
    const overflow = agents.length > inlineVisible;
    const shown = open || !overflow ? agents : agents.slice(0, inlineVisible);
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1">
        {shown.map((agent) => {
          const on = !!installed[agent];
          return (
            <button
              key={agent}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              aria-label={
                on
                  ? t("market.install.success", { agent })
                  : t("market.install.button")
              }
              title={
                on
                  ? t("market.install.success", { agent })
                  : `${t("market.install.button")} · ${agent}`
              }
              onClick={() => handleClick(agent, on)}
              className={`grid size-6 shrink-0 place-items-center rounded-md border transition-all ${
                on
                  ? "border-primary/45 bg-primary/12 text-primary shadow-[0_0_8px_-2px_var(--primary)]"
                  : "border-transparent bg-transparent text-muted-foreground/35 grayscale hover:border-border hover:text-muted-foreground hover:grayscale-0"
              }`}
            >
              <BrandIcon name={agent} className="size-3.5" />
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
            className="shrink-0 rounded-md border border-border bg-surface-2/60 px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
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
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
      >
        {shown.map((agent) => {
          const on = !!installed[agent];
          const isSelected = selected === agent;
          return (
            <button
              key={agent}
              type="button"
              aria-pressed={isSelected}
              disabled={disabled}
              title={
                on
                  ? t("market.install.success", { agent })
                  : isSelected
                    ? t("market.install.target")
                    : `${t("market.install.button")} · ${agent}`
              }
              onClick={() => handleClick(agent, on)}
              className={`flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[12px] transition-colors ${
                isSelected || on
                  ? "border-primary/40 bg-primary/12 text-foreground"
                  : "border-border bg-surface-2/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              <BrandIcon name={agent} className="size-3.5 shrink-0" />
              <span className="truncate">{agent}</span>
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
