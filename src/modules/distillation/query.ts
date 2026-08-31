/**
 * Distillation query transport bridge. Exposes server-function wrappers
 * (load + start/approve/cancel) around the server-only `api.server.ts` so the
 * page and route can import a single entry point
 * (`../modules/distillation/query`) without pulling server internals into the
 * renderer bundle. Mirrors the sessions/dashboard pattern.
 *
 * The `DistillationPage` component is intentionally NOT re-exported here: the
 * page imports the start/approve/cancel server fns from this module, so
 * re-exporting it would form a relative import cycle
 * (query -> presentation -> query) that the architecture verifier blocks.
 * Routes import the page directly from `presentation/DistillationPage.tsx`.
 */
import { createServerFn } from "@tanstack/react-start";

import { AppError } from "../../lib/errors.ts";
import type { Locale } from "../../lib/i18n/locale.ts";
import type {
  DistillationActionResponse,
  DistillationSaveSkillInput,
  DistillationSaveSkillResponse,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel,
} from "./presentation/index.ts";

export type {
  DistillationActionResponse,
  DistillationSaveSkillInput,
  DistillationSaveSkillResponse,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel,
};

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function validateSessionRefs(value: unknown): {
  source: string;
  sessionId: string;
}[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new AppError("errors.distillation.invalidSelection");
  const refs = value.map((item) => {
    if (
      item == null ||
      typeof item !== "object" ||
      typeof (item as { source?: unknown }).source !== "string" ||
      typeof (item as { sessionId?: unknown }).sessionId !== "string" ||
      !OPAQUE_ID.test((item as { source: string }).source) ||
      !OPAQUE_ID.test((item as { sessionId: string }).sessionId)
    ) {
      throw new AppError("errors.distillation.invalidSelection");
    }
    const ref = item as { source: string; sessionId: string };
    return { source: ref.source, sessionId: ref.sessionId };
  });
  const keys = refs.map((ref) => `${ref.source}:${ref.sessionId}`);
  if (new Set(keys).size !== keys.length)
    throw new AppError("errors.distillation.invalidSelection");
  return refs;
}

/**
 * Validate the optional user-selected transcript segments (Story B-100).
 * Each segment references an opaque session plus an inclusive 0-based message
 * window; windows must be non-negative and non-inverted. The transport never
 * reads the transcript — it only forwards the refs for the application to
 * load in memory.
 */
function validateSegments(value: unknown): {
  source: string;
  sessionId: string;
  startIndex: number;
  endIndex: number;
}[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length === 0)
    throw new AppError("errors.distillation.invalidSelection");
  const segments = value.map((item) => {
    const record = item as {
      source?: unknown;
      sessionId?: unknown;
      startIndex?: unknown;
      endIndex?: unknown;
    };
    if (
      record == null ||
      typeof record !== "object" ||
      typeof record.source !== "string" ||
      typeof record.sessionId !== "string" ||
      !OPAQUE_ID.test(record.source) ||
      !OPAQUE_ID.test(record.sessionId) ||
      !Number.isInteger(record.startIndex) ||
      !Number.isInteger(record.endIndex) ||
      (record.startIndex as number) < 0 ||
      (record.endIndex as number) < 0 ||
      (record.startIndex as number) > (record.endIndex as number)
    ) {
      throw new AppError("errors.distillation.invalidSelection");
    }
    return {
      source: record.source,
      sessionId: record.sessionId,
      startIndex: record.startIndex as number,
      endIndex: record.endIndex as number,
    };
  });
  const keys = segments.map(
    (segment) =>
      `${segment.source}:${segment.sessionId}:${segment.startIndex}:${segment.endIndex}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new AppError("errors.distillation.invalidSelection");
  return segments;
}

/**
 * Normalize + validate the distillation start input. Exported for route
 * tests (same pattern as `validateSessionsPageInput`); the server fn wraps it.
 */
export function validateStartDistillationInput(
  input: unknown,
): DistillationStartInput {
  const refs = validateSessionRefs(
    (input as { sessionRefs?: unknown })?.sessionRefs,
  );
  const segments = validateSegments(
    (input as { segments?: unknown })?.segments,
  );
  const modelId =
    typeof (input as { modelId?: unknown })?.modelId === "string" &&
    (input as { modelId: string }).modelId.trim().length > 0
      ? (input as { modelId: string }).modelId.trim()
      : undefined;
  const promptText =
    typeof (input as { promptText?: unknown })?.promptText === "string" &&
    (input as { promptText: string }).promptText.trim().length > 0
      ? (input as { promptText: string }).promptText.trim().slice(0, 4_000)
      : undefined;
// Output kind (prototype output): skill/workflow/prompt/profile/task. Unknown
  // values are dropped so the server keeps its memory default.
  const rawKind = (input as { kind?: unknown })?.kind;
  const kind =
    typeof rawKind === "string" &&
    (["memory", "brief", "prompt", "persona", "skill"] as const).includes(
      rawKind as "memory" | "brief" | "prompt" | "persona" | "skill",
    )
      ? (rawKind as "memory" | "brief" | "prompt" | "persona" | "skill")
      : undefined;
  return {
    sessionRefs: refs,
    ...(segments.length > 0 ? { segments } : {}),
    ...(modelId ? { modelId } : {}),
    ...(promptText ? { promptText } : {}),
    ...(kind ? { kind } : {}),
  };
}

/** Resolve the distillation read model on the server (route loader). */
export const getDistillationQuery = createServerFn({ method: "GET" })
  .validator((value: Locale) => value)
  .handler(async ({ data }): Promise<DistillationViewModel> => {
    const { loadDistillation } = await import("./api.server.ts");
    return loadDistillation(data);
  });

/** Low-cost Skill Management KPI request, intentionally separate from the
 * workbench loader so Skill Management can become interactive first. */
export const getDistillationActivity = createServerFn({
  method: "GET",
}).handler(async () => {
  const { loadDistillationActivity } = await import("./api.server.ts");
  return loadDistillationActivity();
});

/** Poll the server-owned progress of a distillation task. */
export const getDistillationTask = createServerFn({ method: "GET" })
  .validator((input: { taskId: string }) => {
    if (
      typeof input?.taskId !== "string" ||
      !/^distill-task:[A-Za-z0-9-]+$/.test(input.taskId)
    ) {
      throw new AppError("errors.distillation.notFound");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { getDistillationTask: read } =
      await import("./task-state.server.ts");
    return read(data.taskId);
  });

/** Start a distillation run from the selected session refs (+ optional segments). */
export const startDistillation = createServerFn({ method: "POST" })
  .validator(validateStartDistillationInput)
  .handler(async ({ data }): Promise<DistillationStartResponse> => {
    const { startDistillation: run } = await import("./api.server.ts");
    return run(data);
  });

/** Approve a waiting candidate (the only path that writes a knowledge draft). */
export const approveCandidate = createServerFn({ method: "POST" })
  .validator((input: { candidateId: string; actor?: string }) => {
    if (
      typeof input?.candidateId !== "string" ||
      !OPAQUE_ID.test(input.candidateId)
    ) {
      throw new AppError("errors.distillation.notFound");
    }
    return {
      candidateId: input.candidateId,
      actor:
        typeof input.actor === "string" && input.actor.trim().length > 0
          ? input.actor.trim()
          : "user",
    };
  })
  .handler(async ({ data }): Promise<DistillationActionResponse> => {
    const { approveCandidate: run } = await import("./api.server.ts");
    return run(data.candidateId, data.actor);
  });

/** Cancel a waiting candidate (no knowledge draft is created or modified). */
export const cancelCandidate = createServerFn({ method: "POST" })
  .validator((input: { candidateId: string }) => {
    if (
      typeof input?.candidateId !== "string" ||
      !OPAQUE_ID.test(input.candidateId)
    ) {
      throw new AppError("errors.distillation.notFound");
    }
    return { candidateId: input.candidateId };
  })
  .handler(async ({ data }): Promise<DistillationActionResponse> => {
    const { cancelCandidate: run } = await import("./api.server.ts");
    return run(data.candidateId);
  });

export const deleteCandidates = createServerFn({ method: "POST" })
  .validator((input: { candidateIds: string[] }) => {
    if (
      !Array.isArray(input?.candidateIds) ||
      input.candidateIds.length === 0 ||
      input.candidateIds.length > 100 ||
      input.candidateIds.some((id) => typeof id !== "string" || id.length > 200)
    ) {
      throw new AppError("errors.distillation.notFound");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { deleteCandidates: run } = await import("./api.server.ts");
    return run(data.candidateIds);
  });

/**
 * Save an approved candidate's knowledge note as a local Skill. The server
 * re-validates the candidate (must be approved), the skill name and the
 * target agent against the shared `SKILL_AGENTS` list.
 */
export const saveCandidateAsSkill = createServerFn({ method: "POST" })
  .validator((input: DistillationSaveSkillInput) => {
    if (
      typeof input?.candidateId !== "string" ||
      !OPAQUE_ID.test(input.candidateId)
    ) {
      throw new AppError("errors.distillation.notFound");
    }
    if (
      typeof input?.skillName !== "string" ||
      input.skillName.trim().length === 0
    ) {
      throw new AppError("errors.distillation.invalidName");
    }
    if (
      typeof input?.targetAgent !== "string" ||
      input.targetAgent.trim().length === 0
    ) {
      throw new AppError("errors.distillation.invalidAgent");
    }
    const content =
      typeof input?.content === "string" && input.content.trim().length > 0
        ? input.content.trim().slice(0, 16_000)
        : undefined;
    const files = Array.isArray(input.files)
      ? input.files
          .filter(
            (file) =>
              file != null &&
              typeof file.path === "string" &&
              typeof file.content === "string" &&
              file.path.trim().length > 0 &&
              file.content.length > 0,
          )
          .slice(0, 32)
          .map((file) => ({
            path: file.path.trim().slice(0, 240),
            content: file.content.slice(0, 64_000),
          }))
      : undefined;
    return {
      candidateId: input.candidateId,
      skillName: input.skillName.trim().slice(0, 64),
      targetAgent: input.targetAgent.trim(),
      ...(content ? { content } : {}),
      ...(files?.length ? { files } : {}),
    };
  })
  .handler(async ({ data }): Promise<DistillationSaveSkillResponse> => {
    const { saveCandidateAsSkill: run } = await import("./api.server.ts");
    return run(data);
  });
