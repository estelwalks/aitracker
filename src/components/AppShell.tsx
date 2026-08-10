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
  const { locale, t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const [navQuery, setNavQuery] = useState("");
  const [lastUpdated, setLastUpdated] = useState("—");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      if (w < 1024) setCollapsed(true);
      // 侧边栏宽度随桌面视口平滑缩放，浏览器缩放时不挤压内容
      setSidebarWidth(Math.round(Math.min(240, Math.max(168, w * 0.13))));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // This is deliberately derived in the client instead of shipping a stale
  // prototype timestamp in the application chrome. It marks the current UI
  // session becoming ready; data-owning modules render their own source times.
  useEffect(() => {
    setLastUpdated(
      new Intl.DateTimeFormat(locale, {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date()),
    );
  }, [locale]);

  const visibleNav = nav.filter((item) =>
    t(item.label).toLocaleLowerCase().includes(navQuery.toLocaleLowerCase()),
  );

  return (
    <div className="tt-app-shell flex min-h-screen bg-background text-foreground">
      <aside
        className="tt-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200"
        style={{ width: collapsed ? 56 : sidebarWidth }}
      >
        <div className="flex h-16 items-center gap-2.5 px-3">
          <div className="tt-brand-mark flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-[11px] font-bold tracking-[0.08em] text-primary-foreground">
            TT
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold tracking-[0.02em]">
                {APP_NAME}
              </div>
              <div className="tt-num mt-0.5 text-[10px] tracking-[0.08em] text-muted-foreground">
                v{APP_VERSION}
              </div>
            </div>
          )}
        </div>

        {!collapsed && (
          <div className="relative mx-3 mb-4">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={navQuery}
              onChange={(event) => setNavQuery(event.target.value)}
              placeholder={t("common.search")}
              aria-label={t("common.search")}
              className="h-9 w-full rounded-lg border border-sidebar-border bg-sidebar-accent/50 pr-8 pl-9 text-xs outline-none transition focus:border-primary/70 focus:bg-sidebar-accent"
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
        )}

        <nav aria-label={APP_NAME} className="flex-1 space-y-1 px-2">
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
                className={`tt-nav-item relative flex h-10 items-center gap-3 rounded-md px-2.5 text-sm transition-colors ${
                  active
                    ? "bg-primary/12 font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
                aria-current={active ? "page" : undefined}
              >
                {active && (
                  <span className="absolute top-2 bottom-2 -left-2 w-[3px] rounded-r bg-primary" />
                )}
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            title={t("common.collapse")}
            className="flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
            {!collapsed && <span>{t("common.collapse")}</span>}
          </button>
          <div className="flex h-7 items-center gap-2 px-2.5">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ok" />
            {!collapsed && (
              <span className="text-[11px] text-muted-foreground">
                {t("common.localServiceConnected")}
              </span>
            )}
          </div>
        </div>
      </aside>

      <div
        className="flex min-h-screen min-w-0 flex-1 flex-col transition-[padding] duration-200"
        style={{ paddingLeft: collapsed ? 56 : sidebarWidth }}
      >
        <main className="tt-app-main tt-scroll min-w-0 flex-1 px-3 py-5 pb-14 sm:px-5 md:px-8 2xl:px-10">
          <div className="tt-container">{children}</div>
        </main>

        <div
          className="tt-status-bar fixed right-0 bottom-0 z-20 flex h-8 items-center gap-3 overflow-hidden border-t border-border bg-sidebar px-3 text-[11px] whitespace-nowrap text-muted-foreground transition-[left] duration-200 md:gap-5 md:px-4"
          style={{ left: collapsed ? 56 : sidebarWidth }}
        >
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-ok" />{" "}
            {t("common.localApiConnected")}
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="size-1.5 rounded-full bg-primary" />{" "}
            {t("common.dataCollectionLive")}
          </span>
          <span className="tt-num ml-auto shrink-0">
            {t("common.lastUpdatedAt", { time: lastUpdated })}
          </span>
        </div>
      </div>
    </div>
  );
}
