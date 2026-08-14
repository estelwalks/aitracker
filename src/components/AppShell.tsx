import { Link, useRouterState } from "@tanstack/react-router";
import {
  BookHeart,
  Flame,
  FlaskConical,
  IdCard,
  LayoutDashboard,
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

type NavItem = {
  to:
    | "/"
    | "/agents"
    | "/distill"
    | "/reports"
    | "/security"
    | "/tracker"
    | "/skills";
  label: MessageKey;
  icon: typeof LayoutDashboard;
};

/**
 * Sidebar mirrors the V3.0 prototype tiering: Workspace (home/tools/distill/
 * reports), Insights & Security (guard/tracker) and Skill Library (skill hub).
 * Session management and agent orchestration stay reachable via in-page links,
 * not the sidebar.
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
      { to: "/distill", label: "nav.distill", icon: FlaskConical },
      { to: "/reports", label: "nav.memory", icon: BookHeart },
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
    items: [{ to: "/skills", label: "nav.skillHub", icon: Store }],
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
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setCollapsed(width < 1024);
      setSidebarWidth(Math.round(Math.min(272, Math.max(212, width * 0.155))));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const railWidth = collapsed ? 64 : sidebarWidth;

  return (
    <div className="tt-app-shell flex min-h-screen bg-background text-foreground">
      <aside
        className="tt-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar"
        style={{ width: railWidth }}
      >
        <div
          className={`tt-sidebar-brand flex h-16 items-center px-3 ${collapsed ? "justify-center" : "gap-2.5"}`}
        >
          <div className="tt-brand-mark flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-[11px] font-black tracking-[0.08em] text-background">
            TT
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-[0.02em]">
                {APP_NAME}
              </div>
            </div>
          )}
        </div>

        <nav
          aria-label={APP_NAME}
          className="tt-scroll flex-1 overflow-y-auto px-2 pb-2"
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
                      className={`tt-nav-item flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors ${active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      {!collapsed && (
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-1 px-2 pb-3">
          <Link
            to="/settings"
            title={t("nav.settings")}
            className={`flex h-9 items-center gap-3 rounded-md px-3 text-[13px] font-medium transition-colors ${pathname.startsWith("/settings") ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"} ${collapsed ? "justify-center" : ""}`}
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            {!collapsed && <span>{t("nav.settings")}</span>}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            title={t("nav.collapse")}
            className={`flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground ${collapsed ? "justify-center" : ""}`}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
            {!collapsed && <span>{t("nav.collapse")}</span>}
          </button>
        </div>
      </aside>

      <div
        className="tt-shell-content flex min-h-screen min-w-0 flex-1 flex-col"
        style={{ paddingLeft: railWidth }}
      >
        <main className="tt-app-main tt-scroll min-w-0 flex-1 px-4 py-6 pb-10 md:px-8 2xl:px-10">
          <div className="tt-container">{children}</div>
        </main>
      </div>
    </div>
  );
}
