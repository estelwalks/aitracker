import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BatteryMedium,
  Bluetooth,
  Database,
  Flame,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  Wifi,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import { JarvisWidget } from "./JarvisWidget";
import { useWidgetPrefs } from "./widget-prefs";
import { WidgetThemeScope } from "./widget-theme";
import { useWidgetData, useWidgetMood } from "./widget-data";

const moodColor = {
  idle: "bg-muted-foreground",
  live: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
} as const;
const moodText = {
  idle: "text-muted-foreground",
  live: "text-ok",
  warn: "text-warn",
  danger: "text-foreground",
} as const;

type Beat = {
  icon: LucideIcon;
  short: string;
  long: string;
  tone: string;
};

/** 灵动岛：菜单栏常驻胶囊，真实数据循环播报。 */
function DynamicIsland({
  onClick,
  expandedDefault = false,
}: {
  onClick?: () => void;
  expandedDefault?: boolean;
}) {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, total, security } = useWidgetData();
  const mood = useWidgetMood();
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);

  const danger = security.summary?.dangerousCount ?? 0;
  const top = today.topTools[0];

  const beats = useMemo<Beat[]>(() => {
    const list: Beat[] = [
      {
        icon: danger > 0 ? ShieldAlert : ShieldCheck,
        short:
          danger > 0
            ? t("widget.riskCount", { count: danger })
            : t("widget.safe"),
        long:
          danger > 0
            ? t("widget.riskCount", { count: danger })
            : `${t("widget.dwScanned", { count: security.coverage })}`,
        tone: danger > 0 ? "text-foreground" : "text-ok",
      },
    ];
    if (top) {
      list.push({
        icon: Flame,
        short: `${top.name} ${format.formatTokens(top.tokens)}`,
        long: t("widget.jarvisTopToolConcise", {
          name: top.name,
          tokens: format.formatTokens(top.tokens),
        }),
        tone: "text-warn",
      });
    }
    if (prefs.barStyle !== "icon-num") {
      list.push({
        icon: Gauge,
        short: format.formatTokens(today.tokens),
        long: t("widget.jarvisTotalConcise", {
          tokens: format.formatTokens(total.tokens),
        }),
        tone: "text-foreground",
      });
    }
    if (today.sessions != null) {
      list.push({
        icon: Database,
        short: `${format.formatNumber(today.sessions)}`,
        long: t("widget.jarvisSessionsConcise", { count: today.sessions }),
        tone: "text-muted-foreground",
      });
    }
    return list;
  }, [danger, top, today, total, security.coverage, prefs.barStyle, t, format]);

  const period = prefs.rotate > 0 ? prefs.rotate * 1000 : 0;

  useEffect(() => {
    if (!period) return;
    const timer = window.setInterval(
      () => setIndex((value) => value + 1),
      Math.max(3000, period / 2),
    );
    return () => window.clearInterval(timer);
  }, [period]);

  const beat = beats[index % beats.length] ?? beats[0];
  const expanded = hover || expandedDefault;
  const Icon = beat?.icon ?? ShieldCheck;

  return (
    <button
      type="button"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      className={`group flex h-[26px] items-center gap-2 overflow-hidden rounded-full bg-surface-2 px-2 ring-1 ring-border transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        expanded ? "max-w-[360px]" : "max-w-[200px]"
      }`}
      style={{ minWidth: 150 }}
    >
      {/* 灵魂点 */}
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <span
          className={`absolute inset-0 rounded-full ${moodColor[mood]} opacity-25 tt-breathe`}
        />
        <span
          className={`relative size-[7px] rounded-full ${moodColor[mood]}`}
        />
      </span>

      {prefs.barStyle === "icon" ? (
        <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">
          TT
        </span>
      ) : prefs.barStyle === "icon-dot" ? (
        <span className={`font-mono text-[10.5px] ${moodText[mood]}`}>
          {danger > 0
            ? t("widget.riskCount", { count: danger })
            : t("widget.safe")}
        </span>
      ) : (
        <span className="tt-num shrink-0 font-mono text-[10.5px]">
          {format.formatTokens(today.tokens)}
        </span>
      )}

      <span className="h-3 w-px shrink-0 bg-border/70" />

      {/* 循环播报区 */}
      <span
        key={`${index}-${expanded}`}
        className="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
      >
        <Icon
          className={`size-3 shrink-0 ${beat?.tone ?? "text-muted-foreground"}`}
          strokeWidth={1.75}
        />
        <span
          className={`truncate font-mono text-[10.5px] ${beat?.tone ?? "text-muted-foreground"}`}
        >
          {beat == null ? "" : expanded ? beat.long : beat.short}
        </span>
      </span>
    </button>
  );
}

/** macOS 菜单栏预览：灵动岛胶囊 + 点击行为（弹浮窗 / 打开主窗口）。 */
export function MenuBarIcon({ className = "" }: { className?: string }) {
  const { prefs } = useWidgetPrefs();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  /**
   * barClick 驱动真实行为：Electron 环境走桌面 IPC（弹真实浮窗 / 聚焦主窗
   * 口），浏览器预览页回退为站内跳转与面板预览。
   */
  const handleBarClick = () => {
    const desktop =
      typeof window !== "undefined" ? window.desktopApi : undefined;
    if (prefs.barClick === "main") {
      if (desktop) {
        void desktop.showWindow();
      } else {
        void navigate({ to: "/" });
      }
      return;
    }
    if (desktop) {
      void desktop.openWidgetWindow();
    } else {
      setOpen((value) => !value);
    }
  };

  return (
    <WidgetThemeScope>
      <div className={`relative ${className}`}>
        <div className="tt-panel flex h-9 items-center justify-end gap-3 px-2.5">
          <span className="flex items-center gap-2 text-muted-foreground/50">
            <Wifi className="size-3.5" strokeWidth={1.6} />
            <Bluetooth className="size-3.5" strokeWidth={1.6} />
            <BatteryMedium className="size-4" strokeWidth={1.6} />
          </span>
          <DynamicIsland onClick={handleBarClick} />
          <span className="font-mono text-[10.5px] text-muted-foreground/60">
            09:41
          </span>
        </div>

        {open && prefs.barClick === "panel" && (
          <div className="absolute right-0 z-20 mt-2">
            <JarvisWidget />
          </div>
        )}
      </div>
    </WidgetThemeScope>
  );
}
