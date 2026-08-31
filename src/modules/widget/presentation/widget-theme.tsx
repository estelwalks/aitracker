import type { ReactNode } from "react";

import { useWidgetPrefs } from "./widget-prefs";
import "./widget-theme.css";

/**
 * Theme scope for widget preview: Force dark color within subtree when `widgetTheme === "dark"`
 * Variable (the preview remains dark when the app is in light theme); follows the app theme when `system` is used.
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
