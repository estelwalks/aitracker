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
  ControlledSessionSummary,
  DistillationApplication,
  DistillationAssetCounts,
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
import {
  buildFilesForQualification,
  qualifySkillFiles,
  type SkillQualification,
} from "../qualify.ts";
import { localDateKey } from "../quota.ts";
import { compactSegmentMaterials } from "../compression.ts";

/** Marker separating the controlled metadata context from user-picked segments. */
const SEGMENT_SECTION = "--- 用户选择片段 ---";

/**
 * A real-model distillation call is one routed to a genuine model endpoint
 * (a saved S-500 model profile) rather than the deterministic offline
 * fallback. Only these calls consume the daily quota, because only they can
 * incur real provider cost.
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
  if (refs.some((ref) => !isOpaqueSessionRef(ref))) return false;
  const keys = refs.map((ref) => `${ref.source}:${ref.sessionId}`);
  if (new Set(keys).size !== keys.length) return false;

  const segments = request.selection.segments;
  if (segments == null || segments.length === 0) return true;
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

  /** Generate the bottom line: the maximum number of retries for ability products (skill/brief/prompt) (first time + 2 corrections). */
  const MAX_QUALITY_RETRIES = 2;

  /**
   * Generate a side pocket: After the real model runs out the results, an automatic quality inspection is performed. If it fails, the reason for the failure will be reported.
   * Append to the prompt word and rerun; if the result is still unqualified multiple times, the last result will be forced to be output (the user will no longer be blocked).
   * Non-ability types (memory/portrait) or offline mode do not do this cycle.
   */
  async function runWithQualityFallback(
    ai: NonNullable<DistillationPorts["ai"]>,
    baseRequest: AIRequest,
    kind: CandidateOutput["kind"],
    rows: readonly ControlledSessionSummary[],
  ): Promise<AIExecutionResult> {
    if (kind !== "skill" && kind !== "brief" && kind !== "prompt")
      return ai.execute(baseRequest);
    let request = baseRequest;
    const lastQualification: SkillQualification | null = null;
    for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt += 1) {
      const execution = await ai.execute(request);
      // Quality inspection is a comprehensive enhancement: any exceptions in the build/quality inspection will directly return the results, preventing the quality inspection from blowing up the generation.
      let qualification: SkillQualification | null = null;
      try {
        const summary = execution.response?.text?.trim() ?? "";
        const files = buildFilesForQualification(
          summary,
          kind,
          `${rows.length} 场会话蒸馏产物`,
        );
        qualification = qualifySkillFiles(files, kind);
      } catch {
        return execution;
      }
      if (qualification.pass) return execution;
      // Still unqualified for the last time → Forced output (withdrawal) without retrying.
      if (attempt >= MAX_QUALITY_RETRIES) return execution;
      const failures = qualification.checks
        .filter((check) => !check.pass)
        .map(
          (check) =>
            `${check.label}${check.detail ? `（${check.detail}）` : ""}`,
        )
        .join("；");
      request = {
        ...request,
        prompt: {
          ...request.prompt,
          template: `${request.prompt.template}\n\n【质检反馈·第 ${attempt + 1} 次】上次输出不合格：${failures}\n请针对上述问题修正后重新输出，不要解释、不要添加额外说明。`,
        },
      };
    }
    // The theory is unreachable; the last result is guaranteed to be returned.
    return ai.execute(request);
  }

  return {
    async start(
      request,
    ): Promise<Result<DistillationResult, DistillationErrorCode>> {
      await ready();
      if (!validRequest(request))
        return err("errors.distillation.invalidSelection");
      if (request.signal?.aborted) return err("errors.distillation.cancelled");

      // B-600 / P2-10: atomically reserve one daily call BEFORE the model is
      // invoked. `reserve` performs the limit check and the increment in a
      // single ledger write, so concurrent starts can never overshoot the
      // daily limit (the old read-then-increment was a check-then-act race).
      // A successful reservation counts even if the run later fails — the
      // quota is an upper-bound control, not an exact billing counter. A
      // missing or failing quota port degrades to unlimited: distillation
      // must never be blocked by quota bookkeeping itself.
      const realModel = isRealModelRequest(request);
      if (realModel && ports.quota) {
        let reserved = false;
        try {
          reserved = await ports.quota.reserve(localDateKey(now()));
        } catch {
          reserved = true; // ledger failure → degrade to unlimited
        }
        if (!reserved) {
          const current = await ports.quota.read().catch(() => undefined);
          return err(
            "errors.distillation.quotaExceeded",
            current ? { limit: current.limit } : undefined,
          );
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
      const compactedMaterials = compactSegmentMaterials(materials);
      const segmentBlock =
        compactedMaterials.length > 0
          ? `\n\n${SEGMENT_SECTION}\n${segmentMarkdown(compactedMaterials)}`
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
        // Generate the bottom line: real models + capability products with quality inspection and retry, and forced output if multiple failures occur.
        execution = isRealModelRequest(request)
          ? await runWithQualityFallback(
              ports.ai,
              aiRequest,
              request.kind ?? "memory",
              controlled,
            )
          : await ports.ai.execute(aiRequest);
      } catch {
        if (isRealModelRequest(request))
          return err("errors.distillation.aiFailed");
        execution = fallbackExecution(aiRequest);
      }
      if (request.signal?.aborted || execution.summary.status === "cancelled")
        return err("errors.distillation.cancelled");
      // A real-model run that did not actually complete (provider error,
      // timeout, silent fallback) must not fabricate a "distilled" result —
      // surface the failure honestly instead.
      if (
        isRealModelRequest(request) &&
        execution.summary.status !== "completed"
      )
        return err("errors.distillation.aiFailed");
      // The daily quota was already consumed atomically by `reserve` before
      // the model call (P2-10); no second increment here.
      const candidateOutput = candidate(
        nextId(),
        request.selection.sessionRefs,
        controlled,
        execution,
        now().toISOString(),
        request.kind,
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
      // FR-026 Correction: Distilled memory is correctly classified in the memory bank - persona→portrait (type:profile),
      // memory→task memory (type:task), reuse the `type:` prefix of knowledge/api.server.ts
      // Convention, let toMemoryEntry project the correct type. Ability products (brief/skill/prompt)
      // Without the type prefix, the memory does not display them.
      const typeRef =
        current.kind === "persona"
          ? "type:profile"
          : current.kind === "memory"
            ? "type:task"
            : undefined;
      const draft = await ports.knowledge.createDraft({
        kind:
          current.kind === "memory" || current.kind === "persona"
            ? "memory"
            : current.kind === "brief"
              ? "brief"
              : "snippet",
        title: current.title,
        // Persist the distilled body (PRD FR-014 title + text): the memory hub
        // card and Markdown export show the full generated memory, not a
        // 160-char provenance fragment. Content is the safety-filtered
        // candidate summary — raw conversation is never stored.
        content: current.summary,
        persistContent: true,
        provenance: [
          ...current.selectedSessionRefs.map((ref) => ({
            sourceRef: `session:${ref.source}:${ref.sessionId}` as never,
            sourceType: "session" as const,
            capturedAt: current.generatedAt,
            // The candidate summary has been security filtered by domain (path → ~/, credential value → [REDACTED]),
            // Directly as a provenance summary, let the memory card show the real content rather than placeholder copy.
            summary: current.summary.slice(0, 200),
          })),
          ...(typeRef
            ? [
                {
                  sourceRef: typeRef as never,
                  sourceType: "session" as const,
                  capturedAt: current.generatedAt,
                },
              ]
            : []),
        ],
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
        // Once approved, it will be dropped into the knowledge base, and the asset link (memory asset → memory base entry) will be recorded and persisted along with the candidate.
        knowledgeAssetId: approved.value.assetId,
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

    async delete(candidateId: string): Promise<boolean> {
      await ready();
      if (!candidates.has(candidateId)) return false;
      candidates.delete(candidateId);
      if (ports.persistence?.delete)
        await ports.persistence.delete(candidateId);
      return true;
    },

    async count(): Promise<number | null> {
      if (!ports.knowledge) return null;
      const result = await ports.knowledge.list();
      return isOk(result) ? result.value.length : null;
    },

    async counts(): Promise<DistillationAssetCounts> {
      if (!ports.knowledge) return { capability: null, memory: null };
      const result = await ports.knowledge.list();
      if (!isOk(result)) return { capability: null, memory: null };
      let capability = 0;
      let memory = 0;
      for (const asset of result.value) {
        if (asset.kind === "memory") memory += 1;
        else capability += 1;
      }
      return { capability, memory };
    },
  };
}
