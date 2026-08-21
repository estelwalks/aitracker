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
import { localDateKey, type DistillQuota } from "../quota.ts";
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

  /** 生成兜底：能力类产物（skill/brief/prompt）最多重试次数（首次 + 2 次修正）。 */
  const MAX_QUALITY_RETRIES = 2;

  /**
   * 生成侧兜底：真实模型跑出结果后做一次自动质检，不合格就带上失败原因
   * 追加到提示词重跑；多次仍不合格则强制输出最后一次结果（不再阻塞用户）。
   * 非能力类（记忆/画像）或离线模式不做此循环。
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
      // 质检是兜底增强：构建/质检任何异常都直接返回结果，不让质检炸掉生成。
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
      // 最后一次仍不合格 → 强制输出（兜底），不再重试。
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
    // 理论不可达；保底返回最后一次结果。
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
        // 生成兜底：真实模型 + 能力类产物带质检重试，多次不合格强制输出。
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
      // FR-026 修正：蒸馏记忆在记忆库正确分类——persona→画像(type:profile)、
      // memory→任务记忆(type:task)，复用 knowledge/api.server.ts 的 `type:` 前缀
      // 约定，让 toMemoryEntry 投影出正确类型。能力类产物（brief/skill/prompt）
      // 不打 type 前缀，记忆库不展示它们。
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
        // Persist the distilled body (PRD FR-014 标题+正文): the memory hub
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
            // 候选摘要已由 domain 做过安全过滤（路径→~/、凭据值→[REDACTED]），
            // 直接作为 provenance 摘要，让记忆库卡片展示真实内容而非占位文案。
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
        // 批准即落知识库，记录资产链接（记忆资产 → 记忆库条目），随候选持久化。
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
