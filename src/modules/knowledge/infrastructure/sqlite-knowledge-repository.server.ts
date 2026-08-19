import { err, ok, type Result } from "../../../shared/result.ts";
import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type { Clock } from "../../../platform/persistence/contracts.ts";
import type {
  ContentHash,
  CreateDraftInput,
  DedupeSuggestion,
  HashPort,
  KnowledgeAsset,
  KnowledgeFilter,
  KnowledgeRepository,
  KnowledgeStatus,
  KnowledgeVersion,
  KnowledgeVersionedEntry,
  Provenance,
} from "../contracts.ts";

const ASSET_COLUMNS = `asset_id, kind, title, current_version, status,
  security_verdict, created_at_ms, updated_at_ms, revision`;
const VERSION_COLUMNS = `version_id, asset_id, version, kind, title, content_ref,
  content_hash, created_by, status, security_verdict, created_at_ms,
  updated_at_ms, audit_action, audit_actor`;

function withTransaction<T>(database: SqliteDatabasePort, work: () => T): T {
  const tx = database.transaction();
  tx.begin();
  try {
    const result = work();
    tx.commit();
    return result;
  } catch (error) {
    tx.rollback();
    throw error;
  }
}

function safe(value: string, field: string): string {
  const result = value.trim();
  if (
    !result ||
    result.length > 256 ||
    /[\\/\0]/.test(result) ||
    /(?:bearer\s|sk-|api[_-]?key|password|secret)/i.test(result)
  ) {
    throw new TypeError(`${field} is invalid`);
  }
  return result;
}

function safeHash(value: string): ContentHash {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,255}$/.test(value))
    throw new TypeError("contentHash is invalid");
  return value as ContentHash;
}

function normalizeProvenance(
  items: readonly Provenance[] | undefined,
): readonly Provenance[] {
  return (items ?? []).map((item) => {
    const sourceRef = safe(
      item.sourceRef,
      "sourceRef",
    ) as Provenance["sourceRef"];
    const summary = item.summary?.trim().slice(0, 160);
    if (
      summary &&
      /(?:\/|\\|token|bearer|sk-|api[_-]?key|\b(?:node|npm|pnpm|yarn)\s)/i.test(
        summary,
      )
    ) {
      throw new TypeError("provenance summary is invalid");
    }
    if (!Number.isSafeInteger(Date.parse(item.capturedAt)))
      throw new TypeError("capturedAt is invalid");
    return { ...item, sourceRef, ...(summary ? { summary } : {}) };
  });
}

function transition(from: KnowledgeStatus, to: KnowledgeStatus): boolean {
  return (
    (from === "draft" && to === "approved") ||
    (from === "approved" && to === "published") ||
    ((from === "draft" || from === "approved" || from === "published") &&
      to === "archived")
  );
}

function assetFromRow(row: Readonly<Record<string, unknown>>): KnowledgeAsset {
  return {
    assetId: sqliteText(row.asset_id),
    kind: sqliteText(row.kind) as KnowledgeAsset["kind"],
    title: sqliteText(row.title),
    currentVersion: sqliteInteger(row.current_version),
    status: sqliteText(row.status) as KnowledgeAsset["status"],
    ...(sqliteNullableText(row.security_verdict)
      ? {
          securityVerdict: sqliteText(
            row.security_verdict,
          ) as KnowledgeAsset["securityVerdict"],
        }
      : {}),
    createdAt: iso(row.created_at_ms)!,
    updatedAt: iso(row.updated_at_ms)!,
  };
}

function provenanceFor(
  database: SqliteDatabasePort,
  versionId: string,
): Provenance[] {
  return database
    .prepare(
      "SELECT source_ref, source_type, captured_at_ms, summary FROM knowledge_provenance WHERE version_id = ? ORDER BY sequence",
    )
    .all(versionId)
    .map((row) => ({
      sourceRef: sqliteText(row.source_ref) as Provenance["sourceRef"],
      sourceType: sqliteText(row.source_type) as Provenance["sourceType"],
      capturedAt: iso(row.captured_at_ms)!,
      ...(sqliteNullableText(row.summary)
        ? { summary: sqliteText(row.summary) }
        : {}),
    }));
}

function versionFromRow(
  database: SqliteDatabasePort,
  row: Readonly<Record<string, unknown>>,
): KnowledgeVersion {
  const versionId = sqliteText(row.version_id);
  return {
    versionId,
    assetId: sqliteText(row.asset_id),
    version: sqliteInteger(row.version),
    kind: sqliteText(row.kind) as KnowledgeVersion["kind"],
    title: sqliteText(row.title),
    contentRef: sqliteText(row.content_ref),
    contentHash: safeHash(sqliteText(row.content_hash)),
    provenance: provenanceFor(database, versionId),
    createdBy: sqliteText(row.created_by),
    status: sqliteText(row.status) as KnowledgeVersion["status"],
    ...(sqliteNullableText(row.security_verdict)
      ? {
          securityVerdict: sqliteText(
            row.security_verdict,
          ) as KnowledgeVersion["securityVerdict"],
        }
      : {}),
    createdAt: iso(row.created_at_ms)!,
    updatedAt: iso(row.updated_at_ms)!,
    audit: {
      action: sqliteText(row.audit_action),
      actor: sqliteText(row.audit_actor),
    },
  };
}

export interface SqliteKnowledgeRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly clock: Clock;
  readonly hash: HashPort;
}

export function createSqliteKnowledgeRepository(
  options: SqliteKnowledgeRepositoryOptions,
): KnowledgeRepository {
  const { database } = options;
  const revision = () =>
    sqliteInteger(
      database
        .prepare(
          "SELECT revision FROM knowledge_metadata WHERE singleton_id = 1",
        )
        .get()!.revision,
    );
  const findAsset = (assetId: string) => {
    const row = database
      .prepare(
        `SELECT ${ASSET_COLUMNS} FROM knowledge_assets WHERE asset_id = ?`,
      )
      .get(assetId);
    return row ? assetFromRow(row) : undefined;
  };
  const findVersion = (assetId: string, version?: number) => {
    const row =
      version === undefined
        ? database
            .prepare(
              `SELECT ${VERSION_COLUMNS} FROM knowledge_versions WHERE asset_id = ? ORDER BY version DESC LIMIT 1`,
            )
            .get(assetId)
        : database
            .prepare(
              `SELECT ${VERSION_COLUMNS} FROM knowledge_versions WHERE asset_id = ? AND version = ?`,
            )
            .get(assetId, version);
    return row ? versionFromRow(database, row) : undefined;
  };
  const check = (expected?: number): Result<void> => {
    const current = revision();
    return expected !== undefined && expected !== current
      ? err("errors.knowledge.conflict", { expected, actual: current })
      : ok(undefined);
  };
  const bump = () =>
    database
      .prepare(
        "UPDATE knowledge_metadata SET revision = revision + 1 WHERE singleton_id = 1",
      )
      .run();

  const insertProvenance = (
    versionId: string,
    provenance: readonly Provenance[],
  ) => {
    const statement = database.prepare(
      "INSERT INTO knowledge_provenance (version_id, sequence, source_ref, source_type, captured_at_ms, summary) VALUES (?, ?, ?, ?, ?, ?)",
    );
    provenance.forEach((item, sequence) =>
      statement.run(
        versionId,
        sequence,
        item.sourceRef,
        item.sourceType,
        epoch(item.capturedAt),
        item.summary ?? null,
      ),
    );
  };

  const mutate = async (
    assetId: string,
    next: KnowledgeStatus,
    actor: string,
    expected?: number,
  ): Promise<Result<KnowledgeVersion>> =>
    withTransaction(database, () => {
      const valid = check(expected);
      if (!valid.ok) return valid;
      const asset = findAsset(assetId);
      const current = asset && findVersion(assetId, asset.currentVersion);
      if (!asset || !current) return err("errors.knowledge.notFound");
      if (!transition(current.status, next))
        return err("errors.knowledge.invalidTransition");
      const at = options.clock.now().getTime();
      const safeActor = safe(actor, "actor");
      database
        .prepare(
          "UPDATE knowledge_versions SET status = ?, updated_at_ms = ?, audit_action = ?, audit_actor = ? WHERE version_id = ?",
        )
        .run(next, at, next, safeActor, current.versionId);
      database
        .prepare(
          "UPDATE knowledge_assets SET status = ?, updated_at_ms = ?, revision = revision + 1 WHERE asset_id = ?",
        )
        .run(next, at, assetId);
      bump();
      return ok(findVersion(assetId, asset.currentVersion)!);
    });

  const repository: KnowledgeRepository = {
    async createDraft(input: CreateDraftInput, expectedRevision?: number) {
      return withTransaction(database, () => {
        const valid = check(expectedRevision);
        if (!valid.ok) return valid;
        const title = safe(input.title, "title");
        const createdBy = safe(input.createdBy, "createdBy");
        const assetId = safe(
          input.assetId ?? `asset-${crypto.randomUUID()}`,
          "assetId",
        );
        const existing = findAsset(assetId);
        const version = (existing?.currentVersion ?? 0) + 1;
        const at = options.clock.now().getTime();
        const hash =
          input.contentHash ??
          (input.content === undefined
            ? undefined
            : options.hash.hash(input.content));
        if (!hash) return err("errors.knowledge.contentRequired");
        const contentHash = safeHash(hash);
        const contentRef = safe(
          input.contentRef ?? `content:${contentHash}`,
          "contentRef",
        );
        const actor = safe(input.actor ?? createdBy, "actor");
        const versionId = `${assetId}:v${version}`;
        const provenance = normalizeProvenance(input.provenance);
        database
          .prepare(
            `INSERT INTO knowledge_assets
          (asset_id, kind, title, current_version, status, security_verdict, created_at_ms, updated_at_ms, revision)
          VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, 1)
          ON CONFLICT (asset_id) DO UPDATE SET kind=excluded.kind, title=excluded.title,
            current_version=excluded.current_version, status='draft',
            security_verdict=COALESCE(excluded.security_verdict, knowledge_assets.security_verdict),
            updated_at_ms=excluded.updated_at_ms, revision=knowledge_assets.revision + 1`,
          )
          .run(
            assetId,
            input.kind,
            title,
            version,
            input.securityVerdict ?? null,
            existing ? epoch(existing.createdAt) : at,
            at,
          );
        database
          .prepare(
            `INSERT INTO knowledge_versions
          (version_id, asset_id, version, kind, title, content_ref, content_hash,
           created_by, status, security_verdict, created_at_ms, updated_at_ms,
           audit_action, audit_actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, 'draft', ?)`,
          )
          .run(
            versionId,
            assetId,
            version,
            input.kind,
            title,
            contentRef,
            contentHash,
            createdBy,
            input.securityVerdict ?? null,
            at,
            at,
            actor,
          );
        insertProvenance(versionId, provenance);
        bump();
        return ok(findVersion(assetId, version)!);
      });
    },
    approve: (id, actor, expected) => mutate(id, "approved", actor, expected),
    publish: (id, actor, expected) => mutate(id, "published", actor, expected),
    archive: (id, actor, expected) => mutate(id, "archived", actor, expected),
    async list(filter?: KnowledgeFilter) {
      const rows = database
        .prepare(
          `SELECT ${ASSET_COLUMNS} FROM knowledge_assets
        WHERE (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?)
        ORDER BY updated_at_ms DESC, asset_id DESC`,
        )
        .all(
          filter?.status ?? null,
          filter?.status ?? null,
          filter?.kind ?? null,
          filter?.kind ?? null,
        );
      return ok(rows.map(assetFromRow));
    },
    async listLatest(cursor = {}) {
      const limit = Math.min(Math.max(cursor.limit ?? 50, 1), 100);
      const rows = database
        .prepare(
          `SELECT ${ASSET_COLUMNS} FROM knowledge_assets
        WHERE (? IS NULL OR updated_at_ms < ?)
        ORDER BY updated_at_ms DESC, asset_id DESC LIMIT ?`,
        )
        .all(
          cursor.cursor ? epoch(cursor.cursor) : null,
          cursor.cursor ? epoch(cursor.cursor) : null,
          limit + 1,
        )
        .map(assetFromRow);
      const page = rows.slice(0, limit);
      const total = sqliteInteger(
        database
          .prepare("SELECT COUNT(*) AS count FROM knowledge_assets")
          .get()!.count,
      );
      return ok({
        entries: page,
        ...(rows.length > limit && page.length
          ? { nextCursor: page[page.length - 1]!.updatedAt }
          : {}),
        total,
        revision: revision(),
      });
    },
    async listVersions(filter?: KnowledgeFilter) {
      const rows = database
        .prepare(
          `SELECT
          a.asset_id AS a_asset_id, a.kind AS a_kind, a.title AS a_title,
          a.current_version AS a_current_version, a.status AS a_status,
          a.security_verdict AS a_security_verdict, a.created_at_ms AS a_created_at_ms,
          a.updated_at_ms AS a_updated_at_ms, a.revision AS a_revision, v.*
        FROM knowledge_assets a JOIN knowledge_versions v
          ON v.asset_id = a.asset_id AND v.version = a.current_version
        WHERE (? IS NULL OR a.status = ?) AND (? IS NULL OR a.kind = ?)
        ORDER BY a.updated_at_ms DESC, a.asset_id DESC`,
        )
        .all(
          filter?.status ?? null,
          filter?.status ?? null,
          filter?.kind ?? null,
          filter?.kind ?? null,
        );
      const result: KnowledgeVersionedEntry[] = rows.map((row) => ({
        asset: assetFromRow({
          asset_id: row.a_asset_id,
          kind: row.a_kind,
          title: row.a_title,
          current_version: row.a_current_version,
          status: row.a_status,
          security_verdict: row.a_security_verdict,
          created_at_ms: row.a_created_at_ms,
          updated_at_ms: row.a_updated_at_ms,
          revision: row.a_revision,
        }),
        version: versionFromRow(database, row),
      }));
      return ok(result);
    },
    async get(assetId, version) {
      const row = findVersion(assetId, version);
      return row ? ok(row) : err("errors.knowledge.notFound");
    },
    async suggestDuplicates(contentHash) {
      const rows = database
        .prepare(
          "SELECT asset_id, version, content_hash FROM knowledge_versions WHERE content_hash = ? ORDER BY asset_id, version",
        )
        .all(safeHash(contentHash));
      return ok(
        rows.map((row): DedupeSuggestion => ({
          assetId: sqliteText(row.asset_id),
          version: sqliteInteger(row.version),
          contentHash: safeHash(sqliteText(row.content_hash)),
          reason: "same-content-hash",
        })),
      );
    },
  };
  return repository;
}
