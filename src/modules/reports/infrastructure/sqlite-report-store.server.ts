import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type {
  AssetRef,
  EvidenceRef,
  ReportDocument,
  ReportRun,
  ReportStore,
} from "../contracts.ts";
import { safeReportText } from "../domain.ts";
import { ReportDocumentSchema, ReportRunSchema } from "./report-schemas.ts";

const RUN_COLUMNS = `run_id, definition_id, trigger, status, started_at_ms,
  finished_at_ms, error_code, retryable`;
const DOCUMENT_COLUMNS = `report_id, run_id, definition_id, status, title, body,
  generated_at_ms, template_version, approved_by, approved_at_ms`;

function transaction<T>(database: SqliteDatabasePort, work: () => T): T {
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

function runFromRow(
  row: Readonly<Record<string, unknown>>,
  evidence: readonly EvidenceRef[],
): ReportRun {
  return ReportRunSchema.parse({
    runId: sqliteText(row.run_id),
    definitionId: sqliteText(row.definition_id),
    trigger: sqliteText(row.trigger),
    status: sqliteText(row.status),
    startedAt: iso(row.started_at_ms),
    ...(iso(row.finished_at_ms) ? { finishedAt: iso(row.finished_at_ms) } : {}),
    ...(sqliteNullableText(row.error_code)
      ? { errorCode: sqliteText(row.error_code) }
      : {}),
    ...(row.retryable == null
      ? {}
      : { retryable: sqliteInteger(row.retryable) === 1 }),
    evidence,
  }) as ReportRun;
}

function evidenceFor(
  database: SqliteDatabasePort,
  reportId: string,
): EvidenceRef[] {
  return database
    .prepare(
      "SELECT module, evidence_ref, observed_at_ms FROM report_evidence WHERE report_id = ? ORDER BY sequence",
    )
    .all(reportId)
    .map((row) => ({
      module: sqliteText(row.module) as EvidenceRef["module"],
      ref: sqliteText(row.evidence_ref),
      observedAt: iso(row.observed_at_ms)!,
    }));
}

function runEvidenceFor(
  database: SqliteDatabasePort,
  runId: string,
): EvidenceRef[] {
  return database
    .prepare(
      "SELECT module, evidence_ref, observed_at_ms FROM report_run_evidence WHERE run_id = ? ORDER BY sequence",
    )
    .all(runId)
    .map((row) => ({
      module: sqliteText(row.module) as EvidenceRef["module"],
      ref: sqliteText(row.evidence_ref),
      observedAt: iso(row.observed_at_ms)!,
    }));
}

function assetsFor(database: SqliteDatabasePort, reportId: string): AssetRef[] {
  return database
    .prepare(
      "SELECT asset_id, kind FROM report_assets WHERE report_id = ? ORDER BY kind, asset_id",
    )
    .all(reportId)
    .map((row) => ({
      assetId: sqliteText(row.asset_id),
      kind: sqliteText(row.kind) as AssetRef["kind"],
    }));
}

function documentFromRow(
  database: SqliteDatabasePort,
  row: Readonly<Record<string, unknown>>,
): ReportDocument {
  const reportId = sqliteText(row.report_id);
  return ReportDocumentSchema.parse({
    reportId,
    runId: sqliteText(row.run_id),
    definitionId: sqliteText(row.definition_id),
    status: sqliteText(row.status),
    title: sqliteText(row.title),
    body: sqliteText(row.body),
    generatedAt: iso(row.generated_at_ms),
    templateVersion: sqliteInteger(row.template_version),
    evidence: evidenceFor(database, reportId),
    assets: assetsFor(database, reportId),
    ...(sqliteNullableText(row.approved_by)
      ? { approvedBy: sqliteText(row.approved_by) }
      : {}),
    ...(iso(row.approved_at_ms) ? { approvedAt: iso(row.approved_at_ms) } : {}),
  }) as ReportDocument;
}

function assertSafeRef(value: string): string {
  if (
    !value ||
    value.length > 256 ||
    /(?:[A-Za-z]:[\\/]|\\\\|\/Users\/|\/home\/|Bearer\s|sk-)/i.test(value)
  ) {
    throw new TypeError("report reference is unsafe");
  }
  return value;
}

export function createSqliteReportStore(
  database: SqliteDatabasePort,
): ReportStore {
  const putRun = (input: ReportRun): number => {
    const run = ReportRunSchema.parse(input) as ReportRun;
    run.evidence.forEach((item) => assertSafeRef(item.ref));
    const changes = Number(
      database
        .prepare(
          `INSERT INTO report_runs
      (run_id, definition_id, trigger, status, started_at_ms, finished_at_ms, error_code, retryable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (run_id) DO UPDATE SET definition_id=excluded.definition_id,
        trigger=excluded.trigger, status=excluded.status, started_at_ms=excluded.started_at_ms,
        finished_at_ms=excluded.finished_at_ms, error_code=excluded.error_code,
        retryable=excluded.retryable`,
        )
        .run(
          run.runId,
          run.definitionId,
          run.trigger,
          run.status,
          epoch(run.startedAt),
          epoch(run.finishedAt),
          run.errorCode ?? null,
          run.retryable == null ? null : run.retryable ? 1 : 0,
        ).changes,
    );
    database
      .prepare("DELETE FROM report_run_evidence WHERE run_id = ?")
      .run(run.runId);
    const insertEvidence = database.prepare(
      "INSERT INTO report_run_evidence (run_id, sequence, module, evidence_ref, observed_at_ms) VALUES (?, ?, ?, ?, ?)",
    );
    run.evidence.forEach((item, sequence) =>
      insertEvidence.run(
        run.runId,
        sequence,
        item.module,
        item.ref,
        epoch(item.observedAt),
      ),
    );
    return changes;
  };

  const putDocument = (input: ReportDocument): number => {
    const document = ReportDocumentSchema.parse(input) as ReportDocument;
    if (document.body === undefined)
      throw new TypeError("SQLite report documents require an inline body");
    const body = safeReportText(document.body);
    for (const item of document.evidence) assertSafeRef(item.ref);
    for (const item of document.assets) assertSafeRef(item.assetId);
    const generated = epoch(document.generatedAt)!;
    const changes = Number(
      database
        .prepare(
          `INSERT INTO reports
      (report_id, run_id, definition_id, status, title, body, generated_at_ms,
       template_version, approved_by, approved_at_ms, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (report_id) DO UPDATE SET run_id=excluded.run_id,
        definition_id=excluded.definition_id, status=excluded.status, title=excluded.title,
        body=excluded.body, generated_at_ms=excluded.generated_at_ms,
        template_version=excluded.template_version, approved_by=excluded.approved_by,
        approved_at_ms=excluded.approved_at_ms, updated_at_ms=excluded.updated_at_ms`,
        )
        .run(
          document.reportId,
          document.runId,
          document.definitionId,
          document.status,
          document.title,
          body,
          generated,
          document.templateVersion,
          document.approvedBy ?? null,
          epoch(document.approvedAt),
          generated,
          Date.now(),
        ).changes,
    );
    database
      .prepare("DELETE FROM report_evidence WHERE report_id = ?")
      .run(document.reportId);
    database
      .prepare("DELETE FROM report_assets WHERE report_id = ?")
      .run(document.reportId);
    const evidence = database.prepare(
      "INSERT INTO report_evidence (report_id, sequence, module, evidence_ref, observed_at_ms) VALUES (?, ?, ?, ?, ?)",
    );
    document.evidence.forEach((item, sequence) =>
      evidence.run(
        document.reportId,
        sequence,
        item.module,
        item.ref,
        epoch(item.observedAt),
      ),
    );
    const assets = database.prepare(
      "INSERT INTO report_assets (report_id, asset_id, kind) VALUES (?, ?, ?)",
    );
    document.assets.forEach((item) =>
      assets.run(document.reportId, item.assetId, item.kind),
    );
    return changes;
  };

  return {
    async createRun(run) {
      transaction(database, () => putRun(run));
    },
    async updateRun(run) {
      transaction(database, () => putRun(run));
    },
    async saveDocument(document) {
      transaction(database, () => putDocument(document));
    },
    async getDocument(reportId) {
      const row = database
        .prepare(`SELECT ${DOCUMENT_COLUMNS} FROM reports WHERE report_id = ?`)
        .get(reportId);
      return row ? documentFromRow(database, row) : undefined;
    },
    async latest(definitionId) {
      const row = database
        .prepare(
          `SELECT ${DOCUMENT_COLUMNS} FROM reports WHERE definition_id = ? ORDER BY generated_at_ms DESC, report_id DESC LIMIT 1`,
        )
        .get(definitionId);
      return row ? documentFromRow(database, row) : undefined;
    },
    async listDocuments() {
      return database
        .prepare(
          `SELECT ${DOCUMENT_COLUMNS} FROM reports ORDER BY generated_at_ms DESC, report_id DESC`,
        )
        .all()
        .map((row) => documentFromRow(database, row));
    },
    async listRuns() {
      return database
        .prepare(
          `SELECT ${RUN_COLUMNS} FROM report_runs ORDER BY started_at_ms DESC, run_id DESC`,
        )
        .all()
        .map((row) =>
          runFromRow(row, runEvidenceFor(database, sqliteText(row.run_id))),
        );
    },
  };
}
