import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BatteryMedium,
  Bluetooth,
  Database,
  PanelsTopLeft,
  Wifi,
} from "lucide-react";

import { useI18n } from "../../../lib/i18n/context";
import { GlassOverviewWidget } from "./GlassOverviewWidget";
import { useWidgetPrefs } from "./widget-prefs";
import { resolveWidgetMood, useWidgetData } from "./widget-data";
import "./menu-bar-widget.css";

const statusClass = {
  idle: "tt-menubar-dot--idle",
  live: "tt-menubar-dot--live",
  warn: "tt-menubar-dot--warn",
  danger: "tt-menubar-dot--danger",
} as const;

function clockText(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 参考 macOS 菜单栏原型的常驻白色玻璃胶囊，展示真实实时摘要。 */
export function MenuBarIcon({ className = "" }: { className?: string }) {
  const { t, format } = useI18n();
  const { prefs } = useWidgetPrefs();
  const { today, hasData, security } = useWidgetData();
  const mood = resolveWidgetMood(hasData, security);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const top = today.topTools[0];
  const detail =
    today.cacheRate == null
      ? `${format.formatNumber(today.events)} ${t("widget.events")}`
      : t("widget.cacheRate", {
          percent: Math.round(today.cacheRate),
        });

  const handleClick = () => {
    const desktop =
      typeof window !== "undefined" ? window.desktopApi : undefined;
    if (prefs.barClick === "main") {
      if (desktop) void desktop.showWindow();
      else void navigate({ to: "/" });
      return;
    }
    if (desktop) void desktop.openWidgetWindow();
    else setOpen((value) => !value);
  };

  return (
    <div className={`tt-menubar-wrap ${className}`}>
      <div className="tt-menubar-glass">
        <span className="tt-menubar-system-icons" aria-hidden="true">
          <PanelsTopLeft />
          <Wifi />
          <Bluetooth />
        </span>

        <button
          type="button"
          className="tt-menubar-summary"
          onClick={handleClick}
        >
          <span className={`tt-menubar-dot ${statusClass[mood]}`} />
          <strong>{format.formatTokens(today.tokens)}</strong>
          <i />
          <Database />
          <span className="tt-menubar-model">
            {top?.name ?? t("widget.noData")}
          </span>
          <span className="tt-menubar-detail">{detail}</span>
        </button>

        <span className="tt-menubar-clock">
          <BatteryMedium aria-hidden="true" />
          {clockText(now)}
        </span>
      </div>

      {open && prefs.barClick === "panel" && (
        <div className="tt-menubar-popover">
          <GlassOverviewWidget />
        </div>
      )}
    </div>
  );
}
