import { z } from "zod";

export const MODULE_GROUPS = ["core", "protection", "infrastructure"] as const;
export const MODULE_PLATFORMS = [
  "macos",
  "windows10",
  "windows11",
  "linux",
] as const;
export const MODULE_STATUSES = ["supported", "planned", "unsupported"] as const;
export const MODULE_CAPABILITIES = [
  "read-dashboard",
  "read-usage",
  "read-sessions",
  "read-agents",
  "read-skills",
  "install-skills",
  "run-distillation",
  "read-knowledge",
  "generate-reports",
  "scan-security",
  "monitor-security",
  "search-local-data",
  "read-projects",
  "read-insights",
  "propose-optimization",
  "configure-tasks",
  "manage-settings",
] as const;

const id = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const route = z.string().regex(/^\/[a-z0-9/_-]*$/);
const i18nKey = z.string().regex(/^module\.[a-z][a-zA-Z0-9]*$/);

export const ModuleCatalogEntrySchema = z
  .object({
    id,
    navigation: z
      .object({
        group: z.enum(MODULE_GROUPS),
        route,
        order: z.number().int().positive(),
      })
      .strict(),
    i18n: z.object({ labelKey: i18nKey }).strict(),
    capabilities: z.array(z.enum(MODULE_CAPABILITIES)).min(1),
    platforms: z
      .object({
        macos: z.enum(MODULE_STATUSES),
        windows10: z.enum(MODULE_STATUSES),
        windows11: z.enum(MODULE_STATUSES),
        linux: z.enum(MODULE_STATUSES),
      })
      .strict(),
  })
  .strict();

export const ModuleCatalogSchema = z
  .object({
    catalogVersion: z.literal(1),
    modules: z.array(ModuleCatalogEntrySchema).min(1),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    const keys = new Set<string>();
    const routes = new Set<string>();
    const orders = new Set<number>();
    for (const [index, module] of catalog.modules.entries()) {
      if (ids.has(module.id))
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "id"],
          message: `duplicate module id: ${module.id}`,
        });
      if (keys.has(module.i18n.labelKey))
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "i18n", "labelKey"],
          message: `duplicate i18n key: ${module.i18n.labelKey}`,
        });
      if (routes.has(module.navigation.route))
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "navigation", "route"],
          message: `duplicate route: ${module.navigation.route}`,
        });
      if (orders.has(module.navigation.order))
        ctx.addIssue({
          code: "custom",
          path: ["modules", index, "navigation", "order"],
          message: `duplicate order: ${module.navigation.order}`,
        });
      ids.add(module.id);
      keys.add(module.i18n.labelKey);
      routes.add(module.navigation.route);
      orders.add(module.navigation.order);
    }
  });

export type PublicModuleCatalog = z.infer<typeof ModuleCatalogSchema>;
export type PublicModuleCatalogEntry = PublicModuleCatalog["modules"][number];
export type ModuleNavigationGroup = (typeof MODULE_GROUPS)[number];

const FORBIDDEN_KEYS =
  /(?:command|token|secret|password|credential|filesystem|filePath|directory|process|shell|script|import|modulePath|pricing|rate)/i;
const FORBIDDEN_VALUES =
  /(?:https?:\/\/|(?:^|[\\/])(?:Users|home|tmp|AppData|Library|ProgramData)(?:[\\/]|$)|\b(?:rm|powershell|cmd|bash|sh|node)\b|=>|function\s*\(|<script)/i;

export function assertSafeModuleCatalog(value: unknown): void {
  const visit = (node: unknown, location: string): void => {
    if (Array.isArray(node))
      return node.forEach((item, index) =>
        visit(item, `${location}[${index}]`),
      );
    if (!node || typeof node !== "object") {
      if (typeof node === "string" && FORBIDDEN_VALUES.test(node))
        throw new Error(`unsafe module catalog value at ${location}`);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (FORBIDDEN_KEYS.test(key))
        throw new Error(`forbidden module catalog field at ${location}.${key}`);
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, "$");
}
