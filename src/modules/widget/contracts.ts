export const widgetModuleId = "widget" as const;
export type WidgetModuleId = typeof widgetModuleId;

export interface WidgetModuleContract {
  readonly module: WidgetModuleId;
  readonly schemaVersion: 1;
}
