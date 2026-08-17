import type { WidgetModuleContract } from "../contracts";

/**
 * Widget application boundary. Widgets are renderer-only preview surfaces;
 * there is no server-side widget application today, so the application layer
 * only exposes the module contract.
 */
export interface WidgetApplication {
  readonly contract: WidgetModuleContract;
}

export function createWidgetApplication(): WidgetApplication {
  return { contract: { module: "widget", schemaVersion: 1 } };
}
