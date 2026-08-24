import type { ReactNode } from "react";

import { PageBar } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { GlassOverviewWidget } from "./GlassOverviewWidget";
import { MenuBarIcon } from "./MenuBarIcon";

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

/** 小组件预览页：本轮聚焦菜单栏胶囊与透明白玻璃浮窗两种形态。 */
export function WidgetPage() {
  const { t } = useI18n();
  return (
    <div className="space-y-4 pb-12">
      <PageBar title={t("widget.title")} summary={t("widget.pageDesc")} />

      <div className="space-y-4">
        <Section title={t("widget.menuBar")} desc={t("widget.menuBarDesc")}>
          <MenuBarIcon className="mx-auto" />
        </Section>

        <Section
          title={t("widget.floatPanel")}
          desc={t("widget.glassPanelDesc")}
        >
          <div className="flex justify-center overflow-x-auto py-2">
            <GlassOverviewWidget />
          </div>
        </Section>
      </div>
    </div>
  );
}
