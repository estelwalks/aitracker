import type { ReactNode } from "react";

import { PageBar } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { LargeWidget, MediumWidget, SmallWidget } from "./DesktopWidgets";
import { JarvisWidget } from "./JarvisWidget";
import { MenuBarIcon } from "./MenuBarIcon";
import { TrayWidget } from "./TrayWidget";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius)] bg-surface-2/60 px-5 py-5 ring-1 ring-border/60">
      <div className="mb-4">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {desc}
        </div>
      </div>
      {children}
    </section>
  );
}

function WidgetLabel({ children }: { children: ReactNode }) {
  return <div className="tt-label text-muted-foreground/70">{children}</div>;
}

/** 小组件预览页：浮窗 / 桌面小组件 / 菜单栏 三个 Section。 */
export function WidgetPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4 pb-12">
      <PageBar title={t("widget.title")} summary={t("widget.pageDesc")} />

      <div className="space-y-4">
        <Section
          title={t("widget.floatPanel")}
          desc={t("widget.floatPanelDesc")}
        >
          <div className="tt-scroll flex gap-8 overflow-x-auto pb-1">
            <JarvisWidget />
            <TrayWidget />
          </div>
        </Section>

        <Section
          title={t("widget.desktopWidgets")}
          desc={t("widget.desktopWidgetsDesc")}
        >
          <div className="tt-scroll flex items-start gap-6 overflow-x-auto pb-1">
            <div className="shrink-0 space-y-2">
              <WidgetLabel>{t("widget.small")}</WidgetLabel>
              <SmallWidget />
            </div>
            <div className="shrink-0 space-y-2">
              <WidgetLabel>{t("widget.medium")}</WidgetLabel>
              <MediumWidget />
            </div>
            <div className="shrink-0 space-y-2">
              <WidgetLabel>{t("widget.large")}</WidgetLabel>
              <LargeWidget />
            </div>
          </div>
        </Section>

        <Section title={t("widget.menuBar")} desc={t("widget.menuBarDesc")}>
          <MenuBarIcon className="mx-auto max-w-[420px]" />
        </Section>
      </div>
    </div>
  );
}
