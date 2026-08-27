export { widgetModuleId } from "./contracts";
export type { WidgetModuleContract, WidgetModuleId } from "./contracts";
export { createWidgetApplication } from "./application/index";
export type { WidgetApplication } from "./application/index";
export {
  useWidgetPrefs,
  readWidgetPrefs,
  setWidgetPref,
  resetWidgetPrefs,
  toneLine,
  DEFAULT_WIDGET_PREFS,
  WIDGET_PREFS_STORAGE_KEY,
} from "./presentation/widget-prefs.ts";
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
} from "./presentation/widget-prefs.ts";
