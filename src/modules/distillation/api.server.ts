/**
 * Distillation transport adapter. Server-only: wires the composition root's
 * distillation application into the presentation read model and the
 * start/approve/cancel actions. Only renderer-safe projections cross this
 * boundary: session refs/titles/project/model/timestamps and candidate
 * summaries (already safety-filtered by the distillation domain). The raw
 * session content is never read or returned here.
 *
 * Known limitation (W3.2): the distillation application keeps candidates in
 * an in-memory `Map` keyed by candidate id and intentionally exposes no
 * `list()` port. As a result the workbench cannot enumerate pending
 * candidates after a navigation/refresh — only the just-returned candidate
 * (from `start`) is actionable in the UI. Persisting candidates and exposing
 * a list API is a follow-up; the page copy states this honestly.
 */
import type { Locale } from "../../lib/i18n/locale.ts";
import type { SessionSummary } from "../sessions/contracts.ts";
import type {
  DistillationActionResponse,
  DistillationSessionItem,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel,
} from "./presentation/index.ts";

export type {
  DistillationActionResponse,
  DistillationSessionItem,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel as DistillationLoadResult,
};

function toItem(session: SessionSummary): DistillationSessionItem {
  return {
    source: session.source,
    sessionId: session.sessionId,
    title: session.title,
    projectKey: session.projectKey,
    model: session.model,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turns: session.turns,
    status: session.status,
  };
}

/**
 * Load the distillation workbench read model. Resolves the selectable sessions
 * from the composition root's shared session port. `locale` is accepted for
 * transport parity; the projection is locale-neutral.
 */
export async function loadDistillation(
  _locale: Locale,
): Promise<DistillationViewModel> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const page = await root.sessions.query({ page: 1, pageSize: 100 });
  const sessions = page.ok ? page.value.sessions.map(toItem) : [];
  // TODO(candidate-list): the distillation application exposes no `list()`
  // for in-memory candidates, so the workbench cannot enumerate them. Until
  // that port lands, the page shows the just-produced candidate from `start`
  // and an honest empty state for the candidate list.
  return { sessions, candidates: [] };
}

/**
 * Start a distillation run. Validates the selection, delegates to the
 * application's `start` (which sanitises session metadata before invoking the
 * model), and returns the privacy-safe candidate. Never returns raw session
 * content.
 */
export async function startDistillation(
  input: DistillationStartInput,
): Promise<DistillationStartResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const refs = Array.isArray(input?.sessionRefs) ? input.sessionRefs : [];
  const result = await root.distillation.start({
    requestId: `distill:${crypto.randomUUID()}`,
    selection: { sessionRefs: refs },
    modelId: input.modelId ?? "offline",
    prompt: {
      id: "distillation.summary",
      version: 1,
      template:
        "Summarise the selected sessions' metadata into a concise knowledge note.",
    },
  });
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}

/**
 * Approve a waiting candidate. This is the only path that creates and
 * approves a knowledge draft. Returns the updated candidate.
 */
export async function approveCandidate(
  candidateId: string,
  actor = "user",
): Promise<DistillationActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.distillation.approve(candidateId, actor);
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}

/**
 * Cancel a waiting candidate. No knowledge draft is created or modified.
 */
export async function cancelCandidate(
  candidateId: string,
): Promise<DistillationActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.distillation.cancel(candidateId);
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}
