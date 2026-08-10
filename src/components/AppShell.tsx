import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  MessagesSquare,
  Database,
  Blocks,
  Store,
  ShieldCheck,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { useI18n } from "../lib/i18n/context";
import { APP_NAME, APP_VERSION } from "../lib/app-config";
import type { MessageKey } from "../lib/i18n/messages";

const nav: Array<{
  to:
    | "/"
    | "/skills"
    | "/market"
    | "/security"
    | "/sessions"
    | "/sources"
    | "/settings";
  label: MessageKey;
  icon: typeof Home;
}> = [
  { to: "/", label: "nav.dashboard", icon: Home },
  { to: "/skills", label: "nav.skills", icon: Blocks },
  { to: "/market", label: "nav.market", icon: Store },
  { to: "/security", label: "nav.security", icon: ShieldCheck },
  { to: "/sessions", label: "nav.sessions", icon: MessagesSquare },
  { to: "/sources", label: "nav.sources", icon: Database },
  { to: "/settings", label: "nav.settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(232);
  const [navQuery, setNavQuery] = useState("");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 1024) setCollapsed(true);
      // The workspace shell follows the prototype's roomy desktop rail while
      // preserving a compact, touch-friendly collapsed state.
      setSidebarWidth(Math.round(Math.min(272, Math.max(212, w * 0.155))));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const visibleNav = nav.filter((item) =>
    t(item.label).toLocaleLowerCase().includes(navQuery.toLocaleLowerCase()),
  );

  return (
    <div className="tt-app-shell flex min-h-screen bg-background text-foreground">
      <aside
        className="tt-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200"
        style={{ width: collapsed ? 64 : sidebarWidth }}
      >
        <div
          className={`flex h-16 items-center px-3 ${collapsed ? "justify-center" : "gap-2.5"}`}
        >
          <div className="tt-brand-mark flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground font-mono text-[11px] font-black tracking-[0.08em] text-background">
            TT
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-[0.02em]">
                {APP_NAME}
              </div>
              <div className="tt-num mt-0.5 text-[10px] tracking-[0.08em] text-muted-foreground">
                {t("common.version")} {APP_VERSION}
              </div>
            </div>
          )}
        </div>

        <nav
          aria-label={APP_NAME}
          className="tt-scroll flex-1 overflow-y-auto px-2 pb-2"
        >
          {visibleNav.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            const label = t(item.label);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={label}
                className={`tt-nav-item relative flex h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r-full bg-primary" />
                )}
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="space-y-1 border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            title={t("common.collapse")}
            className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
            {!collapsed && <span>{t("common.collapse")}</span>}
          </button>
        </div>
      </aside>

      <div
        className="flex min-h-screen min-w-0 flex-1 flex-col transition-[padding] duration-200"
        style={{ paddingLeft: collapsed ? 64 : sidebarWidth }}
      >
        <header className="tt-shell-header sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 px-4 md:px-6">
          <div className="relative hidden max-w-2xl flex-1 sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={navQuery}
              onChange={(event) => setNavQuery(event.target.value)}
              placeholder={t("common.search")}
              aria-label={t("common.search")}
              className="h-9 w-full rounded-lg bg-foreground/[0.05] pr-8 pl-9 font-mono text-xs outline-none transition placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
            />
            {navQuery && (
              <button
                type="button"
                onClick={() => setNavQuery("")}
                aria-label={t("common.close")}
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </header>
        <main className="tt-app-main tt-scroll min-w-0 flex-1 px-4 py-6 pb-10 md:px-8 2xl:px-10">
          <div className="tt-container">{children}</div>
        </main>
      </div>
    </div>
  );
}
