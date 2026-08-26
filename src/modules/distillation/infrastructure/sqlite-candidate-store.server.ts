import type { SqliteDatabasePort } from "../../../platform/database/contracts.ts";
import {
  epoch,
  iso,
  sqliteInteger,
  sqliteNullableText,
  sqliteText,
} from "../../../platform/database/sqlite-values.server.ts";
import type {
  CandidateOutput,
  CandidatePersistence,
  SessionRef,
} from "../contracts.ts";
import { PersistedCandidateSchema } from "./candidate-schemas.ts";

const COLUMNS = `candidate_id, kind, title, summary, mode, approval_state,
  generated_at_ms, knowledge_asset_id, ai_request_id, execution_model_id,
  execution_provider_id, execution_prompt_version_id, execution_prompt_version,
  execution_status, execution_used_fallback, execution_cost_confidence,
  execution_cost_microusd, execution_cost_reason, execution_error_code`;

function transaction<T>(database: SqliteDatabasePort, work: () => T): T {
  const tx = database.transaction();
  tx.begin();
  try {
    const value = work();
    tx.commit();
    return value;
  } catch (error) {
    tx.rollback();
    throw error;
  }
}

function safeCandidate(input: CandidateOutput): CandidateOutput {
  const candidate = PersistedCandidateSchema.parse(input) as CandidateOutput;
  if (
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\|\b(?:npm|pnpm|yarn|node|git)\s+|bearer\s|sk-|api[_-]?key|password|secret)/i.test(
      candidate.summary,
    )
  ) {
    throw new TypeError("candidate summary contains sensitive data");
  }
  return candidate;
}

function refs(database: SqliteDatabasePort, candidateId: string): SessionRef[] {
  return database
    .prepare(
      "SELECT source_id, session_id FROM distillation_candidate_sessions WHERE candidate_id = ? ORDER BY sequence",
    )
    .all(candidateId)
    .map((row) => ({
      source: sqliteText(row.source_id),
      sessionId: sqliteText(row.session_id),
    }));
}

function fromRow(
  database: SqliteDatabasePort,
  row: Readonly<Record<string, unknown>>,
): CandidateOutput {
  const micros =
    row.execution_cost_microusd == null
      ? undefined
      : sqliteInteger(row.execution_cost_microusd);
  return PersistedCandidateSchema.parse({
    candidateId: sqliteText(row.candidate_id),
    kind: sqliteText(row.kind),
    title: sqliteText(row.title),
    summary: sqliteText(row.summary),
    mode: sqliteText(row.mode),
    approvalState: sqliteText(row.approval_state),
    selectedSessionRefs: refs(database, sqliteText(row.candidate_id)),
    generatedAt: iso(row.generated_at_ms),
    ...(sqliteNullableText(row.knowledge_asset_id)
      ? { knowledgeAssetId: sqliteText(row.knowledge_asset_id) }
      : {}),
    execution: {
      requestId: sqliteText(row.ai_request_id),
      modelId: sqliteText(row.execution_model_id),
      ...(sqliteNullableText(row.execution_provider_id)
        ? { providerId: sqliteText(row.execution_provider_id) }
        : {}),
      promptVersionId: sqliteText(row.execution_prompt_version_id),
      promptVersion: sqliteInteger(row.execution_prompt_version),
      status: sqliteText(row.execution_status),
      cost: {
        confidence: sqliteText(row.execution_cost_confidence),
        ...(micros === undefined ? {} : { amountUsd: micros / 1_000_000 }),
        currency: "USD",
        reason: sqliteText(row.execution_cost_reason),
      },
      usedFallback: sqliteInteger(row.execution_used_fallback) === 1,
      ...(sqliteNullableText(row.execution_error_code)
        ? { errorCode: sqliteText(row.execution_error_code) }
        : {}),
    },
  }) as CandidateOutput;
}

export function createSqliteCandidatePersistence(
  database: SqliteDatabasePort,
): CandidatePersistence {
  const save = (input: CandidateOutput): number => {
    const candidate = safeCandidate(input);
    const costMicrousd =
      candidate.execution.cost.amountUsd == null
        ? null
        : Math.round(candidate.execution.cost.amountUsd * 1_000_000);
    const executionStatus =
      candidate.execution.status === "budget-exceeded"
        ? "budget"
        : candidate.execution.status;
    database
      .prepare(
        `INSERT INTO ai_executions
      (request_id, capability, provider_id, model_id, prompt_version_id, prompt_version,
       status, used_fallback, cost_microusd, cost_confidence, error_code,
       started_at_ms, finished_at_ms, duration_ms)
      VALUES (?, 'distillation', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT (request_id) DO NOTHING`,
      )
      .run(
        candidate.execution.requestId,
        candidate.execution.providerId ?? null,
        candidate.execution.modelId,
        candidate.execution.promptVersionId,
        candidate.execution.promptVersion,
        executionStatus,
        candidate.execution.usedFallback ? 1 : 0,
        costMicrousd,
        candidate.execution.cost.confidence,
        candidate.execution.errorCode ?? null,
        epoch(candidate.generatedAt),
        epoch(candidate.generatedAt),
      );
    const changed = Number(
      database
        .prepare(
          `INSERT INTO distillation_candidates
      (candidate_id, kind, title, summary, mode, approval_state, generated_at_ms,
       knowledge_asset_id, ai_request_id, execution_model_id,
       execution_provider_id, execution_prompt_version_id,
       execution_prompt_version, execution_status, execution_used_fallback,
       execution_cost_confidence, execution_cost_microusd, execution_cost_reason,
       execution_error_code, approved_at_ms, cancelled_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (candidate_id) DO UPDATE SET kind=excluded.kind, title=excluded.title,
        summary=excluded.summary, mode=excluded.mode, approval_state=excluded.approval_state,
        knowledge_asset_id=excluded.knowledge_asset_id,
        execution_status=excluded.execution_status,
        execution_used_fallback=excluded.execution_used_fallback,
        execution_cost_confidence=excluded.execution_cost_confidence,
        execution_cost_microusd=excluded.execution_cost_microusd,
        execution_cost_reason=excluded.execution_cost_reason,
        execution_error_code=excluded.execution_error_code,
        approved_at_ms=excluded.approved_at_ms, cancelled_at_ms=excluded.cancelled_at_ms`,
        )
        .run(
          candidate.candidateId,
          candidate.kind,
          candidate.title,
          candidate.summary,
          candidate.mode,
          candidate.approvalState,
          epoch(candidate.generatedAt),
          candidate.knowledgeAssetId ?? null,
          candidate.execution.requestId,
          candidate.execution.modelId,
          candidate.execution.providerId ?? null,
          candidate.execution.promptVersionId,
          candidate.execution.promptVersion,
          candidate.execution.status,
          candidate.execution.usedFallback ? 1 : 0,
          candidate.execution.cost.confidence,
          costMicrousd,
          candidate.execution.cost.reason,
          candidate.execution.errorCode ?? null,
          candidate.approvalState === "approved" ? Date.now() : null,
          candidate.approvalState === "cancelled" ? Date.now() : null,
        ).changes,
    );
    database
      .prepare(
        "DELETE FROM distillation_candidate_sessions WHERE candidate_id = ?",
      )
      .run(candidate.candidateId);
    const insertRef = database.prepare(
      "INSERT INTO distillation_candidate_sessions (candidate_id, sequence, source_id, session_id) VALUES (?, ?, ?, ?)",
    );
    candidate.selectedSessionRefs.forEach((ref, sequence) =>
      insertRef.run(candidate.candidateId, sequence, ref.source, ref.sessionId),
    );
    return changed;
  };
  return {
    async list() {
      return database
        .prepare(
          `SELECT ${COLUMNS} FROM distillation_candidates ORDER BY generated_at_ms DESC, candidate_id DESC`,
        )
        .all()
        .map((row) => fromRow(database, row));
    },
    async save(candidate) {
      transaction(database, () => save(candidate));
    },
    async delete(candidateId) {
      transaction(database, () => {
        database
          .prepare(
            "DELETE FROM distillation_candidate_sessions WHERE candidate_id = ?",
          )
          .run(candidateId);
        database
          .prepare("DELETE FROM distillation_candidates WHERE candidate_id = ?")
          .run(candidateId);
      });
    },
  };
}
