import { Link, useRouterState } from "@tanstack/react-router";
import {
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

import {
  APP_BRAND_ICON_DARK_URL,
  APP_BRAND_ICON_LIGHT_URL,
  APP_NAME,
} from "../lib/app-config";
import { useI18n } from "../lib/i18n/context";
import type { MessageKey } from "../lib/i18n/messages";
import { NativeTrayTitleSync } from "../modules/widget/presentation/NativeTrayTitleSync";
import { SecurityScanProgressOverlay } from "../modules/security-assessment/presentation/components/SecurityScanProgressOverlay";
import { PrivacyStrip } from "./PrivacyStrip";
import { WindowChrome, WINDOW_CHROME_HEIGHT } from "./WindowChrome";

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
    | "/chats";
  label: MessageKey;
  icon: typeof LayoutDashboard;
  /** Whether this item receives the reference design's highlighted treatment. */
  hero?: boolean;
};

/** Side navigation (flat single layer, in prototype order): Home Overview / Agent Overview / Distillation Workbench /
 * Memory / Daily and weekly reports / Session management / Skill management / Security detection / Security market / Burning list.
 * Data sources and settings are pinned at the bottom. */
const navItems: readonly NavItem[] = [
  { to: "/", label: "nav.home", icon: LayoutDashboard },
  { to: "/agents", label: "nav.agents", icon: IdCard },
  { to: "/distill", label: "nav.distill", icon: FlaskConical, hero: true },
  { to: "/memory", label: "nav.memoryHub", icon: BookHeart },
  { to: "/reports", label: "nav.reports", icon: FileText },
  { to: "/chats", label: "nav.resume", icon: MessagesSquare },
  { to: "/skills", label: "nav.skillHub", icon: Boxes },
  { to: "/security", label: "nav.guard", icon: ShieldCheck },
  { to: "/market", label: "nav.market", icon: Store },
  { to: "/tracker", label: "nav.tracker", icon: Flame },
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
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  // The floating window widget (/widget?mode=float) reuses this shell, but does not belong to the main window: the self-drawn title bar is not rendered.
  // There is no title bar space at the top either.
  const isWidgetFloat = searchStr.includes("mode=float");
  const chromeOffset = isWidgetFloat ? 0 : WINDOW_CHROME_HEIGHT;

  useEffect(() => {
    const onResize = () => {
      const width = window.innerWidth;
      setCollapsed(width < 1120);
      setSidebarWidth(Math.round(Math.min(200, Math.max(168, width * 0.12))));
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (isWidgetFloat) {
    return (
      <div className="aitracker-widget-float-shell min-h-screen text-foreground">
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  const railWidth = collapsed ? 64 : sidebarWidth;

  return (
    <>
      <NativeTrayTitleSync />
      <div className="aitracker-app-shell flex min-h-screen bg-background text-foreground">
        <WindowChrome />
        <aside
          className="aitracker-sidebar fixed bottom-0 left-0 z-30 flex flex-col bg-sidebar transition-[width] duration-200"
          style={{ width: railWidth, top: chromeOffset }}
        >
          <div
            className={`flex items-center px-3 py-4 ${collapsed ? "justify-center" : "gap-2.5"}`}
          >
            <img
              src={APP_BRAND_ICON_DARK_URL}
              alt=""
              aria-hidden="true"
              className="aitracker-brand-mark aitracker-brand-mark-dark size-7 shrink-0 rounded-md object-cover"
            />
            <img
              src={APP_BRAND_ICON_LIGHT_URL}
              alt=""
              aria-hidden="true"
              className="aitracker-brand-mark aitracker-brand-mark-light size-7 shrink-0 rounded-md object-cover"
            />
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="aitracker-text-body truncate font-semibold tracking-tight">
                  {APP_NAME}
                </div>
              </div>
            )}
          </div>

          <nav
            aria-label={APP_NAME}
            className="aitracker-scroll mt-1 flex-1 overflow-y-auto px-2 pb-2"
          >
            <div className="space-y-0.5">
              {navItems.map((item) => {
                const active = isNavActive(pathname, item.to);
                const Icon = item.icon;
                const label = t(item.label);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    preload="intent"
                    preloadDelay={80}
                    title={label}
                    className={`group relative flex items-center rounded-md py-2 transition-colors ${
                      collapsed ? "justify-center px-0" : "gap-3 px-3"
                    } ${active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon
                      className={`size-5 shrink-0 ${item.hero && !active ? "text-foreground" : ""}`}
                      strokeWidth={1.75}
                    />
                    {!collapsed && (
                      <span className="aitracker-text-body min-w-0 flex-1 truncate font-medium">
                        {label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="shrink-0 space-y-2 px-2 pb-3">
            <Link
              to="/sources"
              preload="intent"
              preloadDelay={80}
              title={t("nav.sources")}
              className={`aitracker-text-body flex items-center rounded-md py-2 transition-colors ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } ${pathname.startsWith("/sources") ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
            >
              <Database className="size-5 shrink-0" strokeWidth={1.75} />
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t("nav.sources")}
                </span>
              )}
            </Link>
            <Link
              to="/settings"
              preload="intent"
              preloadDelay={80}
              title={t("nav.settings")}
              className={`aitracker-text-body flex items-center rounded-md py-2 transition-colors ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } ${pathname.startsWith("/settings") ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground"}`}
            >
              <Settings className="size-5 shrink-0" strokeWidth={1.75} />
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t("nav.settings")}
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              title={t("nav.collapse")}
              className={`aitracker-text-body flex w-full items-center rounded-md py-2 transition-colors ${
                collapsed ? "justify-center px-0" : "gap-3 px-3"
              } text-left text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground`}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-5 shrink-0" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose
                  className="size-5 shrink-0"
                  strokeWidth={1.75}
                />
              )}
              {!collapsed && (
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t("nav.collapse")}
                </span>
              )}
            </button>
          </div>
        </aside>

        <div
          className="aitracker-shell-content flex min-h-screen min-w-0 flex-1 flex-col"
          style={{ paddingLeft: railWidth, paddingTop: chromeOffset }}
        >
          <main className="aitracker-app-main aitracker-scroll min-w-0 flex-1 px-[16px] pt-[12px] pb-14 md:px-[24px] md:pt-[16px] 2xl:px-[32px]">
            <div className="aitracker-container">{children}</div>
          </main>
        </div>

        {/* Persistent privacy strip starts at the rail's right edge (left = railWidth),
          avoids the sidebar's bottom collapse button, and keeps the sidebar usable. */}
        <div
          className="aitracker-privacy-dock fixed right-0 bottom-0 z-40 transition-[left] duration-200"
          style={{ left: railWidth }}
        >
          <PrivacyStrip />
        </div>
        <SecurityScanProgressOverlay />
      </div>
    </>
  );
}
