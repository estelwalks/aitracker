import type { KnowledgeModuleContract } from "../contracts";

export type KnowledgeViewModel = KnowledgeModuleContract;

/** 记忆类型：画像（关于你这个人）/ 任务记忆（约定与决策）。 */
export type MemoryType = "profile" | "task";

/**
 * Renderer-safe memory hub read model. The projection intentionally carries
 * only privacy-filtered metadata: the knowledge module never persists the
 * content (it is hashed on write), so `summary` comes exclusively from the
 * version's provenance summaries — never the original conversation body.
 */
export interface MemoryEntry {
  readonly assetId: string;
  readonly title: string;
  readonly kind: "memory";
  readonly status: string;
  /** 画像 / 任务记忆（手动录入时写入 provenance；蒸馏条目默认画像）。 */
  readonly type: MemoryType;
  /**
   * 来源显示 token："distill" 表示蒸馏来源（sourceType "session"），手动条目
   * 为表单录入的来源名，无 provenance 时为 "unknown"。客户端负责 i18n 文案。
   */
  readonly source: string;
  readonly project?: string;
  /** 安全摘要：蒸馏条目为 provenance 摘要，手动条目为正文截断摘要。 */
  readonly summary: string;
  readonly origin: "distill" | "manual";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemoryListResult {
  readonly entries: readonly MemoryEntry[];
  /** 全部 / 画像 / 任务记忆 计数（由投影直接导出，避免客户端重复统计）。 */
  readonly counts: {
    readonly total: number;
    readonly profile: number;
    readonly task: number;
  };
}

export interface MemoryCreateInput {
  readonly type: MemoryType;
  readonly title: string;
  readonly body: string;
  readonly source?: string;
  readonly project?: string;
}

export interface MemoryUpdateInput extends MemoryCreateInput {
  readonly assetId: string;
}

export interface MemoryActionResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly entry?: MemoryEntry;
}
