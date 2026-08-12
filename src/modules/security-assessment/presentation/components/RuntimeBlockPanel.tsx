import { Link } from "@tanstack/react-router";
import { ArrowRight, ShieldOff } from "lucide-react";

import { EmptyState } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import { SecurityCard } from "./SecurityCard";

/**
 * 运行时防御 · 拦截日志面板。
 *
 * 原型中的该面板曾用静态 mock 常量填充；本项目约定绝不用 mock 数据，
 * 而数据层目前没有真实的运行时拦截事件来源，因此这里渲染一个诚实的
 * 「未开启 / 暂无记录」空态，并引导用户前往扫描配置（桌面端开启后才会
 * 产生真实记录）。本组件不含任何 mock 日志，也不声明其尚不具备的能力。
 */
export function RuntimeBlockPanel() {
  const { t } = useI18n();
  return (
    <SecurityCard
      title={t("security.center.runtimeBlock.title")}
      description={t("security.center.runtimeBlock.desc")}
      action={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-muted-foreground" />
          {t("security.center.runtimeBlock.statusOff")}
        </span>
      }
    >
      <EmptyState
        icon={<ShieldOff className="size-7" strokeWidth={1.5} />}
        title={t("security.center.runtimeBlock.emptyTitle")}
        desc={t("security.center.runtimeBlock.emptyDesc")}
        actions={
          <Link
            to="/settings"
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] hover:opacity-80"
          >
            {t("security.center.runtimeBlock.settings")}
            <ArrowRight className="size-3.5" />
          </Link>
        }
      />
    </SecurityCard>
  );
}
