import { Check, ChevronDown, ChevronUp, Loader2, Plus } from "lucide-react";
import { useState } from "react";

import { BrandIcon } from "../../../components/BrandIcon";
import { useI18n } from "../../../lib/i18n/context";

/**
 * Agent install bar using the reference design: show every installable Agent directly
 * The visual is completely consistent with the prototype - click a single Agent to install/uninstall immediately (the switch is connected from the parent to the real
 * Backend), "Select All/Deselect None" (Plus) for batch. inline variant: immediately followed by the Skill name
 * After that, there is a row of compact icon buttons with no counting skills; they fold into "expand more" when overflowed.
 *
 * Two interaction modes:
 * - Switch mode (onToggle): Click Agent to install/uninstall immediately, and the spinner is displayed during installation.
 * - Selection mode (onSelect): Check the installation target; selected supports multiple selections when passing an array.
 *   onSetAll + allSelected provides all selection/no selection.
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
  /** Click a single Agent: next=true to install, false to uninstall (the parent is connected to the real installation flow). */
  onToggle?: (agent: string, next: boolean) => void;
  /** Select all/Deselect all (inline is displayed as a Plus rounded button, grid is displayed as a link in the upper right corner). */
  onSetAll?: (next: boolean) => void;
  /** Select the installation target mode: single highlight (string) or multiple selections (array). */
  selected?: string | readonly string[] | null;
  /** Select the installation target mode: toggle selection when clicking Agent (multiple selections are maintained by the parent collection). */
  onSelect?: (agent: string) => void;
  /** Installation/uninstallation of an agent in progress (the agent shows loading and is disabled). */
  pendingAgents?: ReadonlySet<string> | null;
  /** Select all status in multi-select mode (press installed to deduce allOn when not provided). */
  allSelected?: boolean | null;
  /** The entire bar is disabled while the installation is in progress. */
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

  const spinner = <Loader2 className="size-5 animate-spin" />;

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
              className={`grid size-9 shrink-0 place-items-center rounded-md border transition-all ${
                on
                  ? "border-transparent bg-white/70 text-primary"
                  : "border-border/60 bg-white/70 text-muted-foreground/40 grayscale hover:border-border hover:text-muted-foreground hover:grayscale-0"
              }`}
            >
              {pending ? (
                spinner
              ) : (
                <BrandIcon name={agent} className="size-5" />
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
            className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-surface-2/60 text-muted-foreground transition-colors hover:text-foreground"
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
            className={`grid size-9 shrink-0 place-items-center rounded-md border transition-colors ${
              toggleAllOn
                ? "border-primary/45 bg-primary/12 text-primary"
                : "border-border bg-surface-2/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            <Plus className="size-5" />
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
                <BrandIcon name={agent} className="size-5 shrink-0" />
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
