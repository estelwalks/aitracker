import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "../../../lib/i18n/context";
import {
  resetWidgetPrefs,
  useWidgetPrefs,
  type WidgetPrefs,
} from "./widget-prefs";
import "./widget-config-panel.css";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="aitracker-widget-config-row"
      data-testid="widget-config-row"
    >
      <div className="aitracker-widget-config-label">{label}</div>
      <div
        className="aitracker-widget-config-options"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
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
      className={`aitracker-widget-config-option${on ? " is-active" : ""}`}
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
  return <div className="aitracker-widget-config-title">{children}</div>;
}

/**
 * Widget configuration panel: menu bar/floating window/desktop widget three sets of options, SQLite persistence.
 * For the "widget" classification of the settings page and ⚙ lightweight configuration reuse in the floating window.
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
    <div className={`aitracker-widget-config-panel ${className}`}>
      {sections.includes("bar") && (
        <section className="aitracker-widget-config-section">
          <SectionTitle>{t("widget.configBar")}</SectionTitle>
          <Row label={t("widget.dynamicBar")}>
            <Group
              k="menuBarEnabled"
              options={[
                { v: true, label: t("widget.enabled") },
                { v: false, label: t("widget.disabled") },
              ]}
            />
          </Row>
          <Row label={t("widget.barStyle")}>
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
        <section className="aitracker-widget-config-section">
          <SectionTitle>{t("widget.configPanel")}</SectionTitle>
          <Row label={t("widget.defaultTab")}>
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
          <Row label={t("widget.tone")}>
            <Group
              k="tone"
              options={[
                { v: "casual", label: t("widget.toneCasual") },
                { v: "concise", label: t("widget.toneConcise") },
                { v: "off", label: t("widget.toneOff") },
              ]}
            />
          </Row>
          <Row label={t("widget.rotate")}>
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
        <section className="aitracker-widget-config-section">
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
          <Row label={t("widget.largeContent")}>
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

      <div className="aitracker-widget-config-reset-row">
        <button
          type="button"
          onClick={() => void resetWidgetPrefs()}
          className="aitracker-widget-config-reset font-mono text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-3" strokeWidth={1.75} />
          {t("widget.resetDefaults")}
        </button>
      </div>
    </div>
  );
}
