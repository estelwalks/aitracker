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
/**
 * Privacy guard (P1-9): only genuine private *shapes* are rejected — absolute
 * user paths and credential VALUES. Standalone technical words (token, prompt,
 * content, …) are legal index terms and must never trip the guard, otherwise
 * one legitimate title ("Token 使用统计") bricks the whole search index.
 *
 * The shapes mirror `src/modules/distillation/domain.ts` (PRIVATE_PATH_RE /
 * CREDENTIAL_VALUE_RE): identity-revealing paths and `key=value` credentials.
 */
const PRIVATE_PATH_RE =
  /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|[A-Za-z]:(?:\\[^\s"'<>|\\]*)+|\\\\[A-Za-z0-9._-]+\\[^\s"'<>|\\]+)/;
const CREDENTIAL_VALUE_RE =
  /(?:sk-[A-Za-z0-9_-]{8,}|pk-[A-Za-z0-9_-]{8,}|bearer\s+[A-Za-z0-9._~-]{12,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*[A-Za-z0-9._~/+=-]{8,})/i;
/** Bare absolute path (POSIX or drive-letter) anywhere in the summary. */
const PATH = /(?:^|\s)(?:\/[^\s]+|[A-Za-z]:[\\/][^\s]+)/;

/**
 * Single source of truth for the search projection privacy guard (S-03).
 * `title` / `textSummary` are rejected only when they carry a real absolute
 * path or a credential value shape. Exported so the repository layer reuses
 * exactly the same check instead of maintaining a divergent pattern list.
 */
export function isSearchProjectionSafe(
  title: string,
  textSummary: string,
): boolean {
  return (
    !PRIVATE_PATH_RE.test(title) &&
    !CREDENTIAL_VALUE_RE.test(title) &&
    !PRIVATE_PATH_RE.test(textSummary) &&
    !CREDENTIAL_VALUE_RE.test(textSummary) &&
    !PATH.test(textSummary)
  );
}

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
  if (!isSearchProjectionSafe(document.title, document.textSummary)) {
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

/**
 * Build a canonical snapshot. Documents that fail the shape/privacy guard are
 * skipped (never allowed to brick the whole index) and counted on the result
 * as `skipped`; a per-document console warning keeps the loss observable.
 */
export function createSnapshot(
  documents: readonly SearchDocument[],
  generatedAt: string,
  stale = false,
): SearchIndexSnapshot & { skipped: number } {
  const deduped = new Map<string, SearchDocument>();
  let skipped = 0;
  for (const document of documents) {
    try {
      assertSearchDocument(document);
      deduped.set(document.id, {
        ...document,
        tags: [...new Set(document.tags)].sort(),
      });
    } catch {
      skipped += 1;
      console.warn(
        `search: skipped document "${document.id}" — does not satisfy the search projection guard`,
      );
    }
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
    skipped,
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
