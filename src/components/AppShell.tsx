import { Link, useRouterState } from "@tanstack/react-router";
import {
  Blocks,
  Database,
  History,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Store,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useI18n } from "../lib/i18n/context";

const navItems = [
  { to: "/", i18nKey: "nav.dashboard", icon: Home },
  { to: "/skills", i18nKey: "nav.skills", icon: Blocks },
  { to: "/market", i18nKey: "nav.market", icon: Store },
  { to: "/security", i18nKey: "nav.security", icon: ShieldCheck },
  { to: "/sessions", i18nKey: "nav.sessions", icon: History },
  { to: "/sources", i18nKey: "nav.sources", icon: Database },
  { to: "/settings", i18nKey: "nav.settings", icon: Settings },
] as const;

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-primary-foreground shadow-[0_0_20px_color-mix(in_oklab,var(--color-primary)_20%,transparent)]">
        T
      </div>
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight">
            TrustTools
          </div>
          <div className="tt-num mt-0.5 text-[9px] tracking-[0.04em] text-muted-foreground">
            V3.0.1
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const sidebarWidth = collapsed ? 64 : 240;

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      setDesktop(media.matches);
      if (media.matches) setMobileOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const renderedNavItems = useMemo(
    () =>
      navItems.map((item) => {
        const active =
          item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const Icon = item.icon;
        const label = t(item.i18nKey);
        return (
          <Link
            key={item.to}
            to={item.to}
            title={collapsed ? label : undefined}
            aria-current={active ? "page" : undefined}
            className={`group relative flex h-10 items-center gap-3 rounded-sm px-3 text-[13px] transition-colors ${
              active
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            }`}
          >
            {active && (
              <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-r bg-primary" />
            )}
            <Icon
              className={`size-4 shrink-0 transition-colors ${active ? "text-primary" : "group-hover:text-foreground"}`}
              strokeWidth={1.75}
            />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        );
      }),
    [t, collapsed, pathname],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {mobileOpen && (
        <button
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="关闭导航"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-200 md:z-30 md:translate-x-0 md:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        style={desktop ? { width: sidebarWidth } : undefined}
      >
        <div className="flex h-[64px] items-center justify-between px-4">
          <Brand compact={desktop && collapsed} />
          <button
            className="text-muted-foreground hover:text-foreground md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2">{renderedNavItems}</nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="hidden h-9 w-full items-center gap-3 rounded-sm px-3 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground md:flex"
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
            {!collapsed && <span>收起</span>}
          </button>
        </div>
      </aside>

      <div
        className="flex min-h-screen min-w-0 flex-col transition-[padding] duration-200"
        style={{ paddingLeft: desktop ? sidebarWidth : 0 }}
      >
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur-xl md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex size-8 items-center justify-center rounded-sm border border-border bg-surface text-muted-foreground"
            aria-label="打开导航"
          >
            <Menu className="size-4" />
          </button>
          <Brand />
          <span className="size-2 rounded-full bg-ok" title="本地数据就绪" />
        </header>

        <main className="tt-scroll min-w-0 flex-1 px-3 py-4 sm:px-5 md:px-7 md:py-5 2xl:px-8">
          <div className="tt-container">{children}</div>
        </main>
      </div>
    </div>
  );
}
