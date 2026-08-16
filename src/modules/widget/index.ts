export { widgetModuleId } from "./contracts";
export type { WidgetModuleContract, WidgetModuleId } from "./contracts";
export type { WidgetViewModel } from "./presentation";
export { createWidgetApplication } from "./application/index";
export type { WidgetApplication } from "./application/index";
export { WidgetPage } from "./presentation/WidgetPage";
export { JarvisWidget } from "./presentation/JarvisWidget";
export { TrayWidget } from "./presentation/TrayWidget";
export {
  SmallWidget,
  MediumWidget,
  LargeWidget,
} from "./presentation/DesktopWidgets";
export { MenuBarIcon } from "./presentation/MenuBarIcon";
export { WidgetConfigPanel } from "./presentation/WidgetConfigPanel";
export { WidgetThemeScope } from "./presentation/widget-theme";
export {
  useWidgetPrefs,
  readWidgetPrefs,
  setWidgetPref,
  resetWidgetPrefs,
  toneLine,
  DEFAULT_WIDGET_PREFS,
  WIDGET_PREFS_STORAGE_KEY,
} from "./presentation/widget-prefs";
export type {
  MenuBarStyle,
  MenuBarClick,
  WidgetTab,
  DefaultTab,
  Tone,
  Rotate,
  SmallContent,
  MediumContent,
  WidgetTheme,
  WidgetPrefs,
} from "./presentation/widget-prefs";
