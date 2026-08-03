import { createServerFn } from "@tanstack/react-start";

import type { PricingSnapshot } from "./types.ts";

export const getPricingSnapshot = createServerFn({ method: "POST" })
  .validator((models: string[]) => {
    if (!Array.isArray(models) || models.length > 1_000)
      throw new Error("模型列表不合法");
    return models.filter(
      (model) => typeof model === "string" && model.trim().length > 0,
    );
  })
  .handler(async ({ data }): Promise<PricingSnapshot> => {
    const { buildPricingSnapshot } = await import("./dynamic.server.ts");
    return buildPricingSnapshot(data);
  });
