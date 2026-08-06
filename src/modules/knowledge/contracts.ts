export const knowledgeModuleId = "knowledge" as const;
export type KnowledgeModuleId = typeof knowledgeModuleId;
export interface KnowledgeModuleContract {
  readonly module: KnowledgeModuleId;
  readonly schemaVersion: 1;
}
