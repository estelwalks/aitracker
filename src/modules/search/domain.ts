import type {
  SearchDocument,
  SearchDocumentType,
  SearchFreshness,
  SearchIndexSnapshot,
  SearchQuery,
  SearchQueryResult,
  SearchResult,
} from "./contracts.ts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,160}$/;
const SAFE_SOURCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,240}$/;
const FORBIDDEN =
  /(?:^|[\\/]|\b)(?:command|resumecommand|prompt|response|transcript|token|apikey|password|secret|content)(?:\b|=)/i;
const PATH = /(?:^|\s)(?:\/[^\s]+|[A-Za-z]:[\\/][^\s]+)/;

export function assertSearchDocument(document: SearchDocument): void {
  if (!SAFE_ID.test(document.id) || !SAFE_SOURCE.test(document.sourceRef)) {
    throw new TypeError("search identifiers must be opaque safe references");
  }
  if (!document.title.trim() || document.title.length > 300) {
    throw new TypeError("search title must be non-empty and bounded");
  }
  if (
    document.tags.length > 32 ||
    document.tags.some((tag) => !SAFE_ID.test(tag))
  ) {
    throw new TypeError("search tags must be safe identifiers");
  }
  if (
    FORBIDDEN.test(document.title) ||
    FORBIDDEN.test(document.textSummary) ||
    PATH.test(document.textSummary)
  ) {
    throw new TypeError("search projection contains forbidden private content");
  }
  if (!Number.isNaN(Date.parse(document.updatedAt))) {
    return;
  }
  throw new TypeError("search updatedAt must be an ISO timestamp");
}

function hash(text: string): string {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16).padStart(8, "0");
}

export function indexVersion(documents: readonly SearchDocument[]): string {
  const canonical = [...documents]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((doc) => [
      doc.id,
      doc.type,
      doc.sourceRef,
      doc.title,
      [...doc.tags].sort(),
      doc.textSummary,
      doc.freshness,
      doc.updatedAt,
    ])
    .map((row) => JSON.stringify(row))
    .join("\n");
  return `search-v1-${hash(canonical)}`;
}

export function createSnapshot(
  documents: readonly SearchDocument[],
  generatedAt: string,
  stale = false,
): SearchIndexSnapshot {
  const deduped = new Map<string, SearchDocument>();
  for (const document of documents) {
    assertSearchDocument(document);
    deduped.set(document.id, {
      ...document,
      tags: [...new Set(document.tags)].sort(),
    });
  }
  const ordered = [...deduped.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  return {
    schemaVersion: 1,
    version: indexVersion(ordered),
    generatedAt,
    stale,
    documents: ordered,
  };
}

export function querySnapshot(
  snapshot: SearchIndexSnapshot,
  query: SearchQuery,
): SearchQueryResult {
  const normalized = query.text.trim().toLocaleLowerCase();
  const types = query.types
    ? new Set<SearchDocumentType>(query.types)
    : undefined;
  const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 20)));
  const results: SearchResult[] = [];
  for (const document of snapshot.documents) {
    if (types && !types.has(document.type)) continue;
    if (!query.includeStale && document.freshness === "stale") continue;
    const haystack =
      `${document.title} ${document.tags.join(" ")} ${document.textSummary}`.toLocaleLowerCase();
    if (!normalized) {
      results.push({ document, score: 0 });
      continue;
    }
    const title = document.title.toLocaleLowerCase();
    const exact =
      title === normalized ? 100 : title.includes(normalized) ? 50 : 0;
    const occurrences = haystack.split(normalized).length - 1;
    const score = exact + occurrences * 10;
    if (score > 0) results.push({ document, score });
  }
  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.document.title.localeCompare(b.document.title) ||
      a.document.id.localeCompare(b.document.id),
  );
  return {
    query: query.text,
    indexVersion: snapshot.version,
    stale: snapshot.stale,
    results: results.slice(0, limit),
  };
}

export function documentFromPublic(input: {
  id: string;
  type: SearchDocumentType;
  sourceRef: string;
  title: string;
  tags?: readonly string[];
  textSummary?: string;
  freshness?: SearchFreshness;
  updatedAt?: string;
}): SearchDocument {
  return {
    id: input.id,
    type: input.type,
    sourceRef: input.sourceRef,
    title: input.title,
    tags: input.tags ?? [],
    textSummary: input.textSummary ?? "",
    freshness: input.freshness ?? "fresh",
    updatedAt: input.updatedAt ?? new Date(0).toISOString(),
  };
}
