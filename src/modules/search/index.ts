export { searchModuleId } from "./contracts";
export type {
  SearchModuleContract,
  SearchModuleId,
  SearchDocument,
  SearchDocumentType,
  SearchFreshness,
  SearchIndexSnapshot,
  SearchIndexRepository,
  SearchQuery,
  SearchQueryResult,
  SearchResult,
} from "./contracts";
export { SearchIndexService, createSearchEventProjection } from "./application";
export {
  createSnapshot,
  documentFromPublic,
  indexVersion,
  querySnapshot,
  assertSearchDocument,
} from "./domain";
export { createSearchIndexRepository } from "./infrastructure/repository";
export type { SearchViewModel } from "./presentation";
