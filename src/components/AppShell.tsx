import { Link, useRouterState } from "@tanstack/react-router";
import {
  AppWindowMac,
  BookHeart,
  Boxes,
  Database,
  FileText,
  Flame,
  FlaskConical,
  IdCard,
  LayoutDashboard,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Store,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { APP_NAME } from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";
import type { MessageKey } from "../lib/i18n/messages";
import { PrivacyStrip } from "./PrivacyStrip";

type NavItem = {
  to:
    | "/"
    | "/agents"
    | "/distill"
    | "/reports"
    | "/memory"
    | "/security"
    | "/tracker"
    | "/skills"
    | "/market"
    | "/chats"
    | "/widget";
  label: MessageKey;
  icon: typeof LayoutDashboard;
  /** 高亮强调项（对齐 V3.0 原型：蒸馏工作台） */
  hero?: boolean;
};

/**
 * Sidebar mirrors the V3.0 prototype tiering: Workspace (home/agents/distill/
 * reports/memory), Insights & Security (guard/tracker) and Skill Library
 * (skill hub / market / session resume / widgets).
 */
const navTiers: ReadonlyArray<{
  label: MessageKey;
  items: readonly NavItem[];
}> = [
  {
    label: "nav.tier1",
    items: [
      { to: "/", label: "nav.home", icon: LayoutDashboard },
      { to: "/agents", label: "nav.agents", icon: IdCard },
      { to: "/distill", label: "nav.distill", icon: FlaskConical, hero: true },
      { to: "/reports", label: "nav.reports", icon: FileText },
      { to: "/memory", label: "nav.memoryHub", icon: BookHeart },
    ],
  },
  {
    label: "nav.tier2",
    items: [
      { to: "/security", label: "nav.guard", icon: ShieldCheck },
      { to: "/tracker", label: "nav.tracker", icon: Flame },
    ],
  },
  {
    label: "nav.tier3",
    items: [
      { to: "/skills", label: "nav.skillHub", icon: Boxes },
      { to: "/market", label: "nav.market", icon: Store },
      { to: "/chats", label: "nav.resume", icon: MessagesSquare },
      { to: "/widget", label: "nav.widget", icon: AppWindowMac },
    ],
  },
];

function isNavActive(pathname: string, to: NavItem["to"]) {
  if (to === "/") return pathname === "/";
  if (to === "/skills") return pathname.startsWith("/skills");
  return pathname.startsWith(to);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(184);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setCollapsed(width < 1024);
      setSidebarWidth(Math.round(Math.min(200, Math.max(168, width * 0.12))));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const railWidth = collapsed ? 64 : sidebarWidth;

  return (
    <div className="tt-app-shell flex min-h-screen bg-background text-foreground">
      <aside
        className="tt-sidebar fixed inset-y-0 left-0 z-30 flex flex-col bg-sidebar transition-[width] duration-200"
        style={{ width: railWidth }}
      >
        <div
          className={`flex items-center px-3 py-4 ${collapsed ? "justify-center" : "gap-2.5"}`}
        >
          <div className="tt-brand-mark flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-[11px] font-black text-background">
            TT
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-[13px] font-semibold tracking-tight">
                {APP_NAME}
              </div>
            </div>
          )}
        </div>

        <nav
          aria-label={APP_NAME}
          className="tt-scroll mt-1 flex-1 overflow-y-auto px-2 pb-2"
        >
          {navTiers.map((group) => (
            <div key={group.label} className="mb-3">
              {!collapsed && (
                <p className="px-3 pt-2 pb-1.5 font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
                  {t(group.label)}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isNavActive(pathname, item.to);
                  const Icon = item.icon;
                  const label = t(item.label);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={label}
                      className={`group relative flex items-center gap-3 rounded-md px-3 py-2 transition-colors ${active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon
                        className={`size-4 shrink-0 ${item.hero && !active ? "text-foreground" : ""}`}
                        strokeWidth={1.75}
                      />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {label}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-2 px-2 pb-3">
          <Link
            to="/sources"
            title={t("nav.sources")}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${pathname.startsWith("/sources") ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
          >
            <Database className="size-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && <span className="truncate">{t("nav.sources")}</span>}
          </Link>
          <Link
            to="/settings"
            title={t("nav.settings")}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-[13px] transition-colors ${pathname.startsWith("/settings") ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && (
              <span className="truncate">{t("nav.settings")}</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={t("nav.collapse")}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4 shrink-0" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4 shrink-0" strokeWidth={1.75} />
            )}
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate">
                {t("nav.collapse")}
              </span>
            )}
          </button>
        </div>
      </aside>

      <div
        className="tt-shell-content flex min-h-screen min-w-0 flex-1 flex-col"
        style={{ paddingLeft: railWidth }}
      >
        <main className="tt-app-main tt-scroll min-w-0 flex-1 px-4 pb-14 pt-4 md:px-8 md:pt-8 2xl:px-10 2xl:pt-10">
          <div className="tt-container">{children}</div>
        </main>
      </div>

      {/* 全局隐私承诺条：常驻底部（参照 V3.0 原型 PrivacyStrip） */}
      <div
        className="fixed inset-x-0 bottom-0 z-40 transition-[padding] duration-200"
        style={{ paddingLeft: railWidth }}
      >
        <PrivacyStrip />
      </div>
    </div>
  );
}
