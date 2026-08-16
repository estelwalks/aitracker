import { err, isOk, ok, type Result } from "../../../shared/result.ts";
import type {
  AIExecutionResult,
  AIRequest,
} from "../../ai-orchestration/contracts.ts";
import type { SessionSummary } from "../../sessions/contracts.ts";
import type {
  CandidateOutput,
  DistillationApplication,
  DistillationErrorCode,
  DistillationPorts,
  DistillationRequest,
  DistillationResult,
  SessionRef,
} from "../contracts.ts";
import {
  candidate,
  controlledContext,
  controlledSessionSummary,
  isOpaqueSessionRef,
} from "../domain.ts";
import { localDateKey, type DistillQuota } from "../quota.ts";

const MAX_SELECTION = 8;

/**
 * A real-model distillation call is one routed to a genuine model endpoint
 * (a saved S-500 profile or the env-configured LLM) rather than the
 * deterministic offline fallback. Only these calls consume the daily quota,
 * because only they can incur real provider cost.
 */
function isRealModelRequest(request: DistillationRequest): boolean {
  return request.modelId !== "offline";
}
const fallbackExecution = (request: AIRequest): AIExecutionResult => ({
  summary: {
    requestId: request.requestId,
    modelId: request.modelId,
    providerId: "offline",
    promptVersionId: request.prompt.id,
    promptVersion: request.prompt.version,
    status: "offline",
    cost: { confidence: "unknown", currency: "USD", reason: "offline" },
    usedFallback: true,
  },
  response: {
    providerId: "offline",
    modelId: request.modelId,
    text: "",
    finishReason: "stop",
  },
});

function validRequest(request: DistillationRequest): boolean {
  const refs = request.selection.sessionRefs;
  if (!request.requestId || !request.modelId || !request.prompt || !refs.length)
    return false;
  if (
    refs.length > MAX_SELECTION ||
    refs.some((ref) => !isOpaqueSessionRef(ref))
  )
    return false;
  const keys = refs.map((ref) => `${ref.source}:${ref.sessionId}`);
  return new Set(keys).size === keys.length;
}

function findSession(sessions: readonly SessionSummary[], ref: SessionRef) {
  return sessions.find(
    (session) =>
      session.source === ref.source && session.sessionId === ref.sessionId,
  );
}

export function createDistillationApplication(
  ports: DistillationPorts,
): DistillationApplication {
  const candidates = new Map<string, CandidateOutput>();
  const now = () => ports.now?.() ?? new Date();
  const nextId = () =>
    ports.createCandidateId?.() ?? `candidate-${crypto.randomUUID()}`;

  // Hydrate once from the optional persistence port. A failed read must never
  // break distillation: the map degrades to empty and the next mutation
  // retries the write. Every start/approve/cancel awaits hydration so a
  // concurrent construction cannot lose a candidate that was already on disk.
  let hydration: Promise<void> = Promise.resolve();
  if (ports.persistence) {
    hydration = ports.persistence.list().then(
      (rows) => {
        for (const row of rows) candidates.set(row.candidateId, row);
      },
      () => undefined,
    );
  }
  const ready = () => hydration;
  const persist = (candidate: CandidateOutput): Promise<void> =>
    ports.persistence?.save(candidate).catch(() => undefined) ??
    Promise.resolve();

  return {
    async start(
      request,
    ): Promise<Result<DistillationResult, DistillationErrorCode>> {
      await ready();
      if (!validRequest(request))
        return err("errors.distillation.invalidSelection");
      if (request.signal?.aborted) return err("errors.distillation.cancelled");

      // B-600 server-side quota: a real-model request that has exhausted
      // today's quota is rejected BEFORE the model is invoked. A missing or
      // failing quota port degrades to unlimited — distillation must never be
      // blocked by quota bookkeeping itself.
      const realModel = isRealModelRequest(request);
      let quotaState: DistillQuota | undefined;
      if (realModel && ports.quota) {
        try {
          quotaState = await ports.quota.read();
        } catch {
          quotaState = undefined;
        }
        if (quotaState && quotaState.used >= quotaState.limit) {
          return err("errors.distillation.quotaExceeded", {
            limit: quotaState.limit,
          });
        }
      }

      const page = await ports.sessions.query({
        page: 1,
        pageSize: 100,
        signal: request.signal,
      });
      if (!isOk(page)) return err("errors.distillation.sessionNotFound");
      const rows = request.selection.sessionRefs.map((ref) =>
        findSession(page.value.sessions, ref),
      );
      if (rows.some((row) => !row))
        return err("errors.distillation.sessionNotFound");
      const controlled = rows.map((row, index) =>
        controlledSessionSummary(row!, request.selection.sessionRefs[index]!),
      );
      const aiRequest: AIRequest = {
        requestId: request.requestId,
        modelId: request.modelId,
        providerId: request.providerId,
        prompt: request.prompt,
        input: { text: controlledContext(controlled) },
        budgetUsd: request.budgetUsd,
        timeoutMs: request.timeoutMs,
        signal: request.signal,
      };
      let execution: AIExecutionResult;
      try {
        execution = await ports.ai.execute(aiRequest);
      } catch {
        execution = fallbackExecution(aiRequest);
      }
      if (request.signal?.aborted || execution.summary.status === "cancelled")
        return err("errors.distillation.cancelled");
      // Record one real-model call for today once the run actually completes.
      // A failed write must never fail the run; offline runs never get here.
      if (realModel && ports.quota) {
        try {
          await ports.quota.increment(localDateKey(now()));
        } catch {
          // Quota bookkeeping is best-effort; the run itself succeeded.
        }
      }
      const candidateOutput = candidate(
        nextId(),
        request.selection.sessionRefs,
        controlled,
        execution,
        now().toISOString(),
      );
      candidates.set(candidateOutput.candidateId, candidateOutput);
      await persist(candidateOutput);
      return ok({
        requestId: request.requestId,
        status: "waiting-approval",
        candidate: candidateOutput,
        execution: candidateOutput.execution,
      });
    },

    async approve(
      candidateId,
      actor,
    ): Promise<Result<DistillationResult, DistillationErrorCode>> {
      await ready();
      const current = candidates.get(candidateId);
      if (!current) return err("errors.distillation.notFound");
      if (current.approvalState !== "waiting-approval")
        return err("errors.distillation.notWaiting");
      if (!ports.knowledge)
        return err("errors.distillation.knowledgeUnavailable");
      const draft = await ports.knowledge.createDraft({
        kind:
          current.kind === "memory" || current.kind === "brief"
            ? current.kind
            : "snippet",
        title: current.title,
        content: current.summary,
        provenance: current.selectedSessionRefs.map((ref) => ({
          sourceRef: `session:${ref.source}:${ref.sessionId}` as never,
          sourceType: "session" as const,
          capturedAt: current.generatedAt,
          summary: "Distilled from selected session metadata",
        })),
        createdBy: actor,
        actor,
      });
      if (!isOk(draft)) return err("errors.distillation.knowledgeFailed");
      const approved = await ports.knowledge.approve(
        draft.value.assetId,
        actor,
      );
      if (!isOk(approved)) return err("errors.distillation.knowledgeFailed");
      const updated: CandidateOutput = {
        ...current,
        approvalState: "approved",
      };
      candidates.set(candidateId, updated);
      await persist(updated);
      return ok({
        requestId: current.execution.requestId,
        status: "approved",
        candidate: updated,
        knowledgeVersion: approved.value,
        execution: current.execution,
      });
    },

    async cancel(
      candidateId,
    ): Promise<Result<DistillationResult, DistillationErrorCode>> {
      await ready();
      const current = candidates.get(candidateId);
      if (!current) return err("errors.distillation.notFound");
      if (current.approvalState !== "waiting-approval")
        return err("errors.distillation.notWaiting");
      const updated: CandidateOutput = {
        ...current,
        approvalState: "cancelled",
      };
      candidates.set(candidateId, updated);
      await persist(updated);
      return ok({
        requestId: current.execution.requestId,
        status: "cancelled",
        candidate: updated,
        execution: current.execution,
      });
    },

    async listWaiting(): Promise<CandidateOutput[]> {
      await ready();
      return [...candidates.values()]
        .filter((item) => item.approvalState === "waiting-approval")
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    },

    async listAll(): Promise<CandidateOutput[]> {
      await ready();
      return [...candidates.values()].sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      );
    },

    async get(candidateId: string): Promise<CandidateOutput | undefined> {
      await ready();
      return candidates.get(candidateId);
    },

    async count(): Promise<number | null> {
      if (!ports.knowledge) return null;
      const result = await ports.knowledge.list();
      return isOk(result) ? result.value.length : null;
    },
  };
}
