import type { MemoryType } from "./index";

/** 类型色标（与原型 memoryTypeMeta 一致的 chart 色）。共享给小模块，
 *  避免 MemoryForm（懒加载 chunk）与 MemoryPage 各自维护一份。 */
export const TYPE_COLORS: Record<MemoryType, string> = {
  profile: "var(--chart-2)",
  task: "var(--chart-4)",
};
