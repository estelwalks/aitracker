import { err, isOk, ok, type Result } from "../../../shared/result.ts";
import type {
  AIExecutionResult,
  AIRequest,
} from "../../ai-orchestration/contracts.ts";
import type {
  SessionSummary,
  SessionTranscript,
} from "../../sessions/contracts.ts";
import type {
  CandidateOutput,
  DistillationApplication,
  DistillationErrorCode,
  DistillationPorts,
  DistillationRequest,
  DistillationResult,
  SegmentMaterial,
  SegmentRef,
  SessionRef,
} from "../contracts.ts";
import {
  candidate,
  controlledContext,
  controlledSessionSummary,
  extractSegmentMessages,
  isOpaqueSessionRef,
  isValidSegmentRef,
  segmentMarkdown,
} from "../domain.ts";

const MAX_SELECTION = 8;
/** Marker separating the controlled metadata context from user-picked segments. */
const SEGMENT_SECTION = "--- 用户选择片段 ---";
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
  if (new Set(keys).size !== keys.length) return false;

  const segments = request.selection.segments;
  if (segments == null || segments.length === 0) return true;
  if (segments.length > MAX_SELECTION) return false;
  if (segments.some((segment) => !isValidSegmentRef(segment))) return false;
  // Every segment must point at a session that is part of the selection so
  // the distilled material always carries its controlled metadata context.
  const selectedKeys = new Set(keys);
  if (
    segments.some(
      (segment) => !selectedKeys.has(`${segment.source}:${segment.sessionId}`),
    )
  )
    return false;
  const segmentKeys = segments.map(
    (segment) =>
      `${segment.source}:${segment.sessionId}:${segment.startIndex}:${segment.endIndex}`,
  );
  return new Set(segmentKeys).size === segmentKeys.length;
}

function findSession(sessions: readonly SessionSummary[], ref: SessionRef) {
  return sessions.find(
    (session) =>
      session.source === ref.source && session.sessionId === ref.sessionId,
  );
}

/**
 * Load every user-selected transcript segment into memory and shape it into
 * `SegmentMaterial`. Any failure (missing transcript, reader error, empty
 * window) drops that segment rather than failing the distillation — matching
 * the existing "session not found" degrade strategy.
 */
async function loadSegmentMaterials(
  segments: readonly SegmentRef[] | undefined,
  transcriptPort: DistillationPorts["transcriptPort"],
  titles: ReadonlyMap<string, string>,
): Promise<readonly SegmentMaterial[]> {
  if (segments == null || segments.length === 0 || transcriptPort == null)
    return [];
  const materials: SegmentMaterial[] = [];
  for (const segment of segments) {
    let transcript: SessionTranscript | null = null;
    try {
      transcript = await transcriptPort.load({
        source: segment.source,
        sessionId: segment.sessionId,
      });
    } catch {
      transcript = null;
    }
    if (transcript == null) continue;
    const messages = extractSegmentMessages(transcript, segment);
    if (messages.length === 0) continue;
    const title = titles.get(`${segment.source}:${segment.sessionId}`);
    materials.push({
      source: segment.source,
      sessionId: segment.sessionId,
      ...(title ? { title } : {}),
      messages,
    });
  }
  return materials;
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
      const context = controlledContext(controlled);
      // User-selected transcript segments are appended to the AI input only.
      // The text lives in memory for this request — it never reaches the
      // candidate, the persistence store, or any other durable output.
      const titles = new Map(
        controlled.map((row) => [
          `${row.ref.source}:${row.ref.sessionId}`,
          row.title,
        ]),
      );
      const materials = await loadSegmentMaterials(
        request.selection.segments,
        ports.transcriptPort,
        titles,
      );
      const segmentBlock =
        materials.length > 0
          ? `\n\n${SEGMENT_SECTION}\n${segmentMarkdown(materials)}`
          : "";
      const aiRequest: AIRequest = {
        requestId: request.requestId,
        modelId: request.modelId,
        providerId: request.providerId,
        prompt: request.prompt,
        input: { text: `${context}${segmentBlock}` },
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
