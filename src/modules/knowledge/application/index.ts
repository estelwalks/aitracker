import { err, ok, type Result } from "../../../shared/result.ts";
import type {
  CreateDraftInput,
  DedupeSuggestion,
  HashPort,
  KnowledgeAsset,
  KnowledgeDocument,
  KnowledgeFilter,
  KnowledgeListCursor,
  KnowledgeListResult,
  KnowledgeRepository,
  KnowledgeRepositoryOptions,
  KnowledgeStatus,
  KnowledgeVersion,
  Provenance,
} from "../contracts.ts";

const EMPTY: KnowledgeDocument = {
  schemaVersion: 1,
  revision: 0,
  assets: [],
  versions: [],
};
const safe = (value: string, field: string): string => {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > 256 ||
    /[\\/\0]/.test(trimmed) ||
    /(?:bearer\s|sk-|api[_-]?key|password|secret)/i.test(trimmed)
  )
    throw new TypeError(`${field} is invalid`);
  return trimmed;
};
const safeHash = (value: string): KnowledgeVersion["contentHash"] => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/.test(value))
    throw new TypeError("contentHash is invalid");
  return value as KnowledgeVersion["contentHash"];
};
// Only reject summaries carrying an actual credential VALUE (OpenAI-style key,
// a long bearer token, or an assigned secret). Plain technical prose — "npm
// run build", "node_modules", "curl /api/v1", "JWT token 过期" — is allowed so
// real distilled memories can be approved.
const SECRET_VALUE_RE =
  /(?:sk-[A-Za-z0-9_-]{10,}|bearer\s+[A-Za-z0-9._~-]{12,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S{8,})/i;
const safeProvenance = (
  input: CreateDraftInput["provenance"],
): readonly Provenance[] =>
  (input ?? []).map((item) => {
    const sourceRef = safe(item.sourceRef, "sourceRef");
    if (/token|bearer|sk-|api[_-]?key/i.test(sourceRef))
      throw new TypeError("sourceRef is invalid");
    const summary = item.summary?.trim().slice(0, 160);
    if (summary && SECRET_VALUE_RE.test(summary))
      throw new TypeError("provenance summary is invalid");
    return {
      ...item,
      sourceRef: sourceRef as Provenance["sourceRef"],
      ...(summary ? { summary } : {}),
    };
  });
const clone = <T>(value: T): T => structuredClone(value);
function transition(status: KnowledgeStatus, next: KnowledgeStatus): boolean {
  return (
    (status === "draft" && next === "approved") ||
    (status === "approved" && next === "published") ||
    ((status === "draft" || status === "approved" || status === "published") &&
      next === "archived")
  );
}

export function createKnowledgeRepository(
  options: KnowledgeRepositoryOptions,
): KnowledgeRepository {
  let tail = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const read = async (): Promise<KnowledgeDocument> => {
    const result = await options.store.read();
    return result.value ?? EMPTY;
  };
  const checkRevision = (
    doc: KnowledgeDocument,
    expected?: number,
  ): Result<void> =>
    expected !== undefined && expected !== doc.revision
      ? err("errors.knowledge.conflict", { expected, actual: doc.revision })
      : ok(undefined);
  const write = (doc: KnowledgeDocument): Promise<void> =>
    options.store.write(doc);
  const findVersion = (
    doc: KnowledgeDocument,
    assetId: string,
    version?: number,
  ): KnowledgeVersion | undefined => {
    const rows = doc.versions.filter(
      (item) =>
        item.assetId === assetId &&
        (version === undefined || item.version === version),
    );
    return rows.sort((a, b) => b.version - a.version)[0];
  };
  const mutate = (
    assetId: string,
    next: KnowledgeStatus,
    actor: string,
    expected?: number,
  ) =>
    serial(async () => {
      const doc = await read();
      const revision = checkRevision(doc, expected);
      if (!revision.ok) return revision;
      const asset = doc.assets.find((item) => item.assetId === assetId);
      const current = asset && findVersion(doc, assetId, asset.currentVersion);
      if (!asset || !current) return err("errors.knowledge.notFound");
      if (!transition(current.status, next))
        return err("errors.knowledge.invalidTransition");
      const now = options.clock.now().toISOString();
      const updated: KnowledgeVersion = {
        ...current,
        status: next,
        updatedAt: now,
        audit: { action: next, actor: safe(actor, "actor") },
      };
      const result: KnowledgeDocument = {
        schemaVersion: 1,
        revision: doc.revision + 1,
        assets: doc.assets.map((item) =>
          item.assetId === assetId
            ? { ...item, status: next, updatedAt: now }
            : item,
        ),
        versions: doc.versions.map((item) =>
          item.versionId === current.versionId ? updated : item,
        ),
      };
      await write(result);
      return ok(clone(updated));
    });
  return {
    createDraft: (input: CreateDraftInput, expectedRevision?: number) =>
      serial(async () => {
        const doc = await read();
        const revision = checkRevision(doc, expectedRevision);
        if (!revision.ok) return revision;
        const title = safe(input.title, "title");
        const createdBy = safe(input.createdBy, "createdBy");
        const assetId = safe(
          input.assetId ?? `asset-${crypto.randomUUID()}`,
          "assetId",
        );
        const existing = doc.assets.find((item) => item.assetId === assetId);
        const version = existing ? existing.currentVersion + 1 : 1;
        const now = options.clock.now().toISOString();
        const contentHash =
          input.contentHash ??
          (input.content !== undefined
            ? options.hash.hash(input.content)
            : undefined);
        if (!contentHash) return err("errors.knowledge.contentRequired");
        const normalizedHash = safeHash(contentHash);
        const contentRef = input.contentRef ?? `content:${normalizedHash}`;
        const row: KnowledgeVersion = {
          versionId: `${assetId}:v${version}`,
          assetId,
          version,
          kind: input.kind,
          title,
          contentRef: safe(contentRef, "contentRef"),
          contentHash: normalizedHash,
          // Memory-kind entries persist their display body (PRD FR-014); all
          // other flows stay hashed-only.
          ...(input.persistContent && input.content !== undefined
            ? { content: input.content }
            : {}),
          provenance: clone(safeProvenance(input.provenance)),
          createdBy,
          status: "draft",
          securityVerdict: input.securityVerdict,
          createdAt: now,
          updatedAt: now,
          audit: {
            action: "draft",
            actor: safe(input.actor ?? createdBy, "actor"),
          },
        };
        const asset: KnowledgeAsset = existing
          ? {
              ...existing,
              currentVersion: version,
              status: "draft",
              title,
              kind: input.kind,
              securityVerdict:
                input.securityVerdict ?? existing.securityVerdict,
              updatedAt: now,
            }
          : {
              assetId,
              kind: input.kind,
              title,
              currentVersion: version,
              status: "draft",
              securityVerdict: input.securityVerdict,
              createdAt: now,
              updatedAt: now,
            };
        const next: KnowledgeDocument = {
          schemaVersion: 1,
          revision: doc.revision + 1,
          assets: existing
            ? doc.assets.map((item) =>
                item.assetId === assetId ? asset : item,
              )
            : [...doc.assets, asset],
          versions: [...doc.versions, row],
        };
        await write(next);
        return ok(clone(row));
      }),
    approve: (assetId, actor, expected) =>
      mutate(assetId, "approved", actor, expected),
    publish: (assetId, actor, expected) =>
      mutate(assetId, "published", actor, expected),
    archive: (assetId, actor, expected) =>
      mutate(assetId, "archived", actor, expected),
    list: (filter?: KnowledgeFilter) =>
      serial(async () => {
        const doc = await read();
        return ok(
          clone(
            doc.assets.filter(
              (item) =>
                (!filter?.status || item.status === filter.status) &&
                (!filter?.kind || item.kind === filter.kind),
            ),
          ),
        );
      }),
    // P4-T4-03: single store read per page; cursor = last updatedAt.
    listLatest: (cursor = {}) =>
      serial(async () => {
        const doc = await read();
        const limit = Math.min(Math.max(cursor.limit ?? 50, 1), 100);
        const sorted = [...doc.assets].sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.assetId.localeCompare(right.assetId),
        );
        const startIndex = cursor.cursor
          ? sorted.findIndex((item) => item.updatedAt === cursor.cursor)
          : -1;
        const from = startIndex >= 0 ? startIndex + 1 : 0;
        const page = sorted.slice(from, from + limit);
        const nextCursor =
          from + page.length < sorted.length
            ? page[page.length - 1]?.updatedAt
            : undefined;
        return ok({
          entries: clone(page),
          ...(nextCursor ? { nextCursor } : {}),
          total: sorted.length,
          revision: doc.revision,
        });
      }),
    // P4-T4-03: ONE store read for the whole filtered list (asset + current
    // version). Transports must not loop `get()` per asset afterwards — that
    // would re-read and re-parse the store file N times.
    listVersions: (filter?: KnowledgeFilter) =>
      serial(async () => {
        const doc = await read();
        const rows = doc.assets
          .filter(
            (item) =>
              (!filter?.status || item.status === filter.status) &&
              (!filter?.kind || item.kind === filter.kind),
          )
          .map((asset) => ({
            asset,
            version: findVersion(doc, asset.assetId, asset.currentVersion),
          }))
          .filter(
            (
              row,
            ): row is { asset: KnowledgeAsset; version: KnowledgeVersion } =>
              row.version !== undefined,
          )
          .sort(
            (left, right) =>
              right.asset.updatedAt.localeCompare(left.asset.updatedAt) ||
              left.asset.assetId.localeCompare(right.asset.assetId),
          );
        return ok(clone(rows));
      }),
    get: (assetId, version) =>
      serial(async () => {
        const row = findVersion(await read(), assetId, version);
        return row ? ok(clone(row)) : err("errors.knowledge.notFound");
      }),
    suggestDuplicates: (contentHash) =>
      serial(async () => {
        const doc = await read();
        const matches: DedupeSuggestion[] = doc.versions
          .filter((item) => item.contentHash === contentHash)
          .map((item) => ({
            assetId: item.assetId,
            version: item.version,
            contentHash: item.contentHash,
            reason: "same-content-hash",
          }));
        return ok(clone(matches));
      }),
  };
}

export interface KnowledgeApplication {
  readonly repository: KnowledgeRepository;
}
export function createKnowledgeApplication(
  options: KnowledgeRepositoryOptions,
): KnowledgeApplication {
  return { repository: createKnowledgeRepository(options) };
}
