import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type {
  AssetAssessment,
  AssetFinding,
  AssetRef,
  SecurityAssessmentHistoryStore,
} from "../contracts.ts";
import { securityAssessmentHistorySchema } from "./atomic-history-store.ts";

const COLUMNS = `assessment_ref, asset_ref, asset_hash_ref, asset_kind, verdict,
  rule_version, rule_provenance, rule_pack_ref, assessed_at_ms, evidence_count`;

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

function validate(input: AssetAssessment): AssetAssessment {
  return securityAssessmentHistorySchema.parse({ entries: [input] })
    .entries[0]!;
}

function fromRow(
  database: SqliteDatabasePort,
  row: Readonly<Record<string, unknown>>,
): AssetAssessment {
  const assessmentRef = sqliteText(row.assessment_ref);
  const findings: AssetFinding[] = database
    .prepare(
      "SELECT finding_ref, severity, status, evidence_ref FROM security_findings WHERE assessment_ref = ? ORDER BY finding_ref",
    )
    .all(assessmentRef)
    .map((finding) => ({
      ref: sqliteText(finding.finding_ref) as AssetFinding["ref"],
      severity: sqliteText(finding.severity) as AssetFinding["severity"],
      status: sqliteText(finding.status) as AssetFinding["status"],
      evidenceRef: sqliteText(
        finding.evidence_ref,
      ) as AssetFinding["evidenceRef"],
    }));
  return validate({
    assessmentRef: assessmentRef as AssetAssessment["assessmentRef"],
    assetRef: sqliteText(row.asset_ref) as AssetAssessment["assetRef"],
    ...(sqliteNullableText(row.asset_hash_ref)
      ? {
          assetHashRef: sqliteText(
            row.asset_hash_ref,
          ) as AssetAssessment["assetHashRef"],
        }
      : {}),
    assetKind: sqliteText(row.asset_kind) as AssetAssessment["assetKind"],
    verdict: sqliteText(row.verdict) as AssetAssessment["verdict"],
    findings,
    ruleVersion: {
      version: sqliteText(row.rule_version),
      provenance: sqliteText(
        row.rule_provenance,
      ) as AssetAssessment["ruleVersion"]["provenance"],
      ...(sqliteNullableText(row.rule_pack_ref)
        ? {
            rulePackRef: sqliteText(row.rule_pack_ref) as NonNullable<
              AssetAssessment["ruleVersion"]["rulePackRef"]
            >,
          }
        : {}),
    },
    assessedAt: iso(row.assessed_at_ms)!,
    evidenceCount: sqliteInteger(row.evidence_count),
  });
}

export function createSqliteSecurityAssessmentHistoryStore(
  database: SqliteDatabasePort,
): SecurityAssessmentHistoryStore {
  const save = (raw: AssetAssessment): number => {
    const item = validate(raw);
    const changed = Number(
      database
        .prepare(
          `INSERT INTO security_assessments
      (assessment_ref, asset_ref, asset_hash_ref, asset_kind, verdict, status,
       rule_version, rule_provenance, rule_pack_ref, assessed_at_ms, evidence_count)
      VALUES (?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?)
      ON CONFLICT (assessment_ref) DO UPDATE SET asset_ref=excluded.asset_ref,
        asset_hash_ref=excluded.asset_hash_ref, asset_kind=excluded.asset_kind,
        verdict=excluded.verdict, status=excluded.status, rule_version=excluded.rule_version,
        rule_provenance=excluded.rule_provenance, rule_pack_ref=excluded.rule_pack_ref,
        assessed_at_ms=excluded.assessed_at_ms, evidence_count=excluded.evidence_count`,
        )
        .run(
          item.assessmentRef,
          item.assetRef,
          item.assetHashRef ?? null,
          item.assetKind,
          item.verdict,
          item.ruleVersion.version,
          item.ruleVersion.provenance,
          item.ruleVersion.rulePackRef ?? null,
          epoch(item.assessedAt),
          item.evidenceCount,
        ).changes,
    );
    database
      .prepare("DELETE FROM security_findings WHERE assessment_ref = ?")
      .run(item.assessmentRef);
    const insert = database.prepare(
      "INSERT INTO security_findings (finding_ref, assessment_ref, severity, status, evidence_ref) VALUES (?, ?, ?, ?, ?)",
    );
    item.findings.forEach((finding) =>
      insert.run(
        finding.ref,
        item.assessmentRef,
        finding.severity,
        finding.status,
        finding.evidenceRef,
      ),
    );
    return changed;
  };
  return {
    async latest(assetRef: AssetRef) {
      const row = database
        .prepare(
          `SELECT ${COLUMNS} FROM security_assessments WHERE asset_ref = ? ORDER BY assessed_at_ms DESC, assessment_ref DESC LIMIT 1`,
        )
        .get(assetRef);
      return row ? fromRow(database, row) : undefined;
    },
    async save(assessment) {
      transaction(database, () => {
        save(assessment);
        database
          .prepare(
            `DELETE FROM security_assessments WHERE assessment_ref IN (
          SELECT assessment_ref FROM security_assessments ORDER BY assessed_at_ms DESC, assessment_ref DESC LIMIT -1 OFFSET 500
        )`,
          )
          .run();
      });
    },
    async list() {
      return database
        .prepare(
          `SELECT ${COLUMNS} FROM security_assessments ORDER BY assessed_at_ms DESC, assessment_ref DESC LIMIT 500`,
        )
        .all()
        .map((row) => fromRow(database, row));
    },
  };
}
