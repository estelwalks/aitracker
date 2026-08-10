import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  BookHeart,
  Flame,
  FlaskConical,
  History,
  IdCard,
  LayoutDashboard,
  LogIn,
  ShieldCheck,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { useI18n } from "../lib/i18n/context";
import { APP_NAME } from "../lib/app-config";
import type { MessageKey } from "../lib/i18n/messages";

type NavItem = {
  to:
    | "/"
    | "/skills"
    | "/market"
    | "/security"
    | "/sessions"
    | "/sources"
    | "/distill"
    | "/reports";
  label: MessageKey;
  icon: typeof LayoutDashboard;
};

const navGroups: ReadonlyArray<{
  label: MessageKey;
  items: readonly NavItem[];
}> = [
  {
    label: "nav.groupCore",
    items: [
      { to: "/", label: "nav.dashboard", icon: LayoutDashboard },
      { to: "/skills", label: "nav.skills", icon: IdCard },
      { to: "/sessions", label: "nav.sessions", icon: History },
      { to: "/distill", label: "nav.distill", icon: FlaskConical },
      { to: "/reports", label: "nav.reports", icon: BookHeart },
    ],
  },
  {
    label: "nav.groupGuard",
    items: [
      { to: "/security", label: "nav.security", icon: ShieldCheck },
      { to: "/market", label: "nav.market", icon: Flame },
    ],
  },
  {
    label: "nav.groupInfrastructure",
    items: [{ to: "/sources", label: "nav.sources", icon: Bot }],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [navQuery, setNavQuery] = useState("");
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        t(item.label)
          .toLocaleLowerCase()
          .includes(navQuery.toLocaleLowerCase()),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="tt-app-shell flex min-h-screen bg-background text-foreground">
      <input
        id="tt-sidebar-toggle"
        type="checkbox"
        className="tt-sidebar-toggle sr-only"
        aria-label={t("nav.collapse")}
      />
      <aside className="tt-sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar">
        <div className="tt-sidebar-brand flex h-16 items-center gap-2.5 px-3">
          <div className="tt-brand-mark flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground font-mono text-[11px] font-black tracking-[0.08em] text-background">
            TT
          </div>
          <div className="tt-sidebar-copy min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-[0.02em]">
              {APP_NAME}
            </div>
          </div>
        </div>

        <nav
          aria-label={APP_NAME}
          className="tt-scroll flex-1 overflow-y-auto px-2 pb-2"
        >
          {visibleGroups.map((group) => (
            <div key={group.label} className="mb-3">
              <p className="tt-sidebar-group-label px-3 pt-2 pb-1.5 font-mono text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase">
                {t(group.label)}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.to === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.to);
                  const Icon = item.icon;
                  const label = t(item.label);
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      title={label}
                      className={`tt-nav-item flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="tt-sidebar-copy min-w-0 flex-1 truncate">
                        {label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-1 px-2 pb-3">
          <button
            type="button"
            disabled
            title={t("nav.loginUnavailable")}
            className="tt-sidebar-bottom-control flex h-9 w-full items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground opacity-60"
          >
            <LogIn className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="tt-sidebar-copy flex min-w-0 flex-1 items-center gap-1.5 truncate">
              {t("nav.login")}
              <span className="ml-auto rounded-sm bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] uppercase">
                {t("nav.soon")}
              </span>
            </span>
          </button>
          <Link
            to="/settings"
            title={t("nav.settings")}
            className={`flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors ${pathname.startsWith("/settings") ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
          >
            <Settings className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="tt-sidebar-copy">{t("nav.settings")}</span>
          </Link>
          <label
            htmlFor="tt-sidebar-toggle"
            title={t("nav.collapse")}
            className="tt-sidebar-bottom-control tt-sidebar-collapse-control flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <PanelLeftClose
              className="tt-sidebar-collapse-close size-4"
              strokeWidth={1.75}
            />
            <PanelLeftOpen
              className="tt-sidebar-collapse-open size-4"
              strokeWidth={1.75}
            />
            <span className="tt-sidebar-copy">{t("nav.collapse")}</span>
          </label>
        </div>
      </aside>

      <div className="tt-shell-content flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="tt-shell-header sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 px-4 md:px-6">
          <div className="relative hidden max-w-2xl flex-1 sm:block">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={navQuery}
              onChange={(event) => setNavQuery(event.target.value)}
              placeholder={t("nav.search")}
              aria-label={t("nav.search")}
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
          <span className="ml-auto inline-flex items-center gap-2 rounded-md bg-foreground/[0.05] px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
            {t("nav.agentStatusUnavailable")}
          </span>
        </header>
        <main className="tt-app-main tt-scroll min-w-0 flex-1 px-4 py-6 pb-10 md:px-8 2xl:px-10">
          <div className="tt-container">{children}</div>
        </main>
      </div>
    </div>
  );
}
