import type { ReactNode } from "react";

import { useWidgetPrefs } from "./widget-prefs";
import "./widget-theme.css";

/**
 * 小组件预览的主题作用域：`widgetTheme === "dark"` 时在子树内强制应用暗色
 * 变量（应用处于亮色主题时预览仍为暗色）；`system` 时跟随应用主题。
 */
export function WidgetThemeScope({ children }: { children: ReactNode }) {
  const { prefs } = useWidgetPrefs();
  return (
    <div
      className={
        prefs.widgetTheme === "dark" ? "aitracker-widget-dark" : undefined
      }
    >
      {children}
    </div>
  );
}
