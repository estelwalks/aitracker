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
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const nav = [
  { to: "/", label: "首页", icon: Home },
  { to: "/skills", label: "Skill 管理", icon: Blocks },
  { to: "/market", label: "Skill 市场", icon: Store },
  { to: "/security", label: "安全检测", icon: ShieldCheck },
  { to: "/sessions", label: "会话恢复", icon: MessagesSquare },
  { to: "/sources", label: "数据来源", icon: Database },
  { to: "/settings", label: "设置", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(200);
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

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        className="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200"
        style={{ width: collapsed ? 56 : sidebarWidth }}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-primary text-[13px] font-bold text-primary-foreground">
            T
          </div>
          {!collapsed && (
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-semibold">TrustTools</div>
              <div className="tt-num text-[10px] text-muted-foreground">
                v1.0.0.1
              </div>
            </div>
          )}
        </div>

        <nav className="mt-2 flex-1 space-y-0.5 px-1.5">
          {nav.map((item) => {
            const active =
              item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={`relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                {active && (
                  <span className="absolute top-1.5 bottom-1.5 -left-1.5 w-[3px] rounded-r bg-primary" />
                )}
                <Icon className="size-4 shrink-0" strokeWidth={1.75} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-1.5">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={1.75} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={1.75} />
            )}
            {!collapsed && <span>收起</span>}
          </button>
          <div className="flex h-7 items-center gap-2 px-2.5">
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-ok" />
            {!collapsed && (
              <span className="text-[11px] text-muted-foreground">
                本地服务已连接
              </span>
            )}
          </div>
        </div>
      </aside>

      <div
        className="flex min-h-screen min-w-0 flex-1 flex-col transition-[padding] duration-200"
        style={{ paddingLeft: collapsed ? 56 : sidebarWidth }}
      >
        <main className="tt-scroll min-w-0 flex-1 px-3 py-4 pb-14 sm:px-4 md:px-6 2xl:px-8">
          <div className="tt-container">{children}</div>
        </main>

        <div
          className="fixed right-0 bottom-0 z-20 flex h-8 items-center gap-3 overflow-hidden border-t border-border bg-sidebar px-3 text-[11px] whitespace-nowrap text-muted-foreground transition-[left] duration-200 md:gap-5 md:px-4"
          style={{ left: collapsed ? 56 : sidebarWidth }}
        >
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-ok" /> 本地 API 已连接
          </span>
          <span className="hidden items-center gap-1.5 md:flex">
            <span className="size-1.5 rounded-full bg-primary" /> 数据采集：实时
          </span>
          <span className="tt-num ml-auto shrink-0">
            上次更新 2026-07-27 10:24:07
          </span>
        </div>
      </div>
    </div>
  );
}
