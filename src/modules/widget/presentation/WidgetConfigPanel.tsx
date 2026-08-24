import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "../../../lib/i18n/context";
import {
  resetWidgetPrefs,
  useWidgetPrefs,
  type WidgetPrefs,
} from "./widget-prefs";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[12.5px]">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[10.5px] text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-1">{children}</div>
    </div>
  );
}

function Opt({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-lg px-2 py-1 font-mono text-[10.5px] transition-colors ${
        on
          ? "bg-foreground text-background"
          : "bg-surface-2 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Group<K extends keyof WidgetPrefs>({
  k,
  options,
}: {
  k: K;
  options: { v: WidgetPrefs[K]; label: string }[];
}) {
  const { prefs, set } = useWidgetPrefs();
  return (
    <>
      {options.map((option) => (
        <Opt
          key={String(option.v)}
          on={prefs[k] === option.v}
          onClick={() => set(k, option.v)}
        >
          {option.label}
        </Opt>
      ))}
    </>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="tt-label mb-1 text-muted-foreground/70">{children}</div>
  );
}

/**
 * 小组件配置面板：菜单栏 / 浮窗 / 桌面小组件 三组选项，SQLite 持久化。
 * 供设置页「小组件」分类与浮窗内 ⚙ 轻量配置复用。
 */
export function WidgetConfigPanel({
  sections = ["bar", "panel", "desktop"],
  className = "",
}: {
  sections?: ("bar" | "panel" | "desktop")[];
  className?: string;
}) {
  const { t } = useI18n();

  return (
    <div className={`space-y-4 ${className}`}>
      {sections.includes("bar") && (
        <section>
          <SectionTitle>{t("widget.configBar")}</SectionTitle>
          <Row label="动态栏">
            <Group
              k="menuBarEnabled"
              options={[
                { v: true, label: "开启" },
                { v: false, label: "关闭" },
              ]}
            />
          </Row>
          <Row label={t("widget.barStyle")} hint={t("widget.barStyleHint")}>
            <Group
              k="barStyle"
              options={[
                { v: "icon", label: t("widget.barIcon") },
                { v: "icon-num", label: t("widget.barIconNum") },
                { v: "icon-dot", label: t("widget.barIconDot") },
              ]}
            />
          </Row>
          <Row label={t("widget.barClick")}>
            <Group
              k="barClick"
              options={[
                { v: "panel", label: t("widget.barClickPanel") },
                { v: "main", label: t("widget.barClickMain") },
              ]}
            />
          </Row>
        </section>
      )}

      {sections.includes("panel") && (
        <section>
          <SectionTitle>{t("widget.configPanel")}</SectionTitle>
          <Row label={t("widget.defaultTab")} hint={t("widget.defaultTabHint")}>
            <Group
              k="defaultTab"
              options={[
                { v: "today", label: t("widget.tabToday") },
                { v: "usage", label: t("widget.tabUsage") },
                { v: "safety", label: t("widget.tabSecurity") },
                { v: "last", label: t("widget.lastUsedTab") },
              ]}
            />
          </Row>
          <Row label={t("widget.tone")} hint={t("widget.toneHint")}>
            <Group
              k="tone"
              options={[
                { v: "casual", label: t("widget.toneCasual") },
                { v: "concise", label: t("widget.toneConcise") },
                { v: "off", label: t("widget.toneOff") },
              ]}
            />
          </Row>
          <Row label={t("widget.rotate")} hint={t("widget.rotateHint")}>
            <Group
              k="rotate"
              options={[
                { v: 5, label: "5s" },
                { v: 10, label: "10s" },
                { v: 30, label: "30s" },
                { v: 0, label: t("widget.rotateManual") },
              ]}
            />
          </Row>
        </section>
      )}

      {sections.includes("desktop") && (
        <section>
          <SectionTitle>{t("widget.configDesktop")}</SectionTitle>
          <Row label={t("widget.smallContent")}>
            <Group
              k="smallContent"
              options={[
                { v: "orb", label: t("widget.smallOrb") },
                { v: "safety", label: t("widget.smallSafety") },
              ]}
            />
          </Row>
          <Row label={t("widget.mediumContent")}>
            <Group
              k="mediumContent"
              options={[
                { v: "brief", label: t("widget.mediumBrief") },
                { v: "today", label: t("widget.mediumToday") },
                { v: "waste", label: t("widget.mediumWaste") },
                { v: "safety", label: t("widget.mediumSafety") },
              ]}
            />
          </Row>
          <Row
            label={t("widget.largeContent")}
            hint={t("widget.largeContentHint")}
          >
            <Opt on onClick={() => {}}>
              {t("widget.threeSignals")}
            </Opt>
          </Row>
          <Row label={t("widget.widgetTheme")}>
            <Group
              k="widgetTheme"
              options={[
                { v: "dark", label: t("widget.themeDark") },
                { v: "system", label: t("widget.themeSystem") },
              ]}
            />
          </Row>
        </section>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void resetWidgetPrefs()}
          className="flex items-center gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
          {t("widget.resetDefaults")}
        </button>
      </div>
    </div>
  );
}
