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
  if (value.length > 8)
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

/** Resolve the distillation read model on the server (route loader). */
export const getDistillationQuery = createServerFn({ method: "GET" })
  .inputValidator((value: Locale) => value)
  .handler(async ({ data }): Promise<DistillationViewModel> => {
    const { loadDistillation } = await import("./api.server.ts");
    return loadDistillation(data);
  });

/** Start a distillation run from the selected session refs. */
export const startDistillation = createServerFn({ method: "POST" })
  .validator((input: DistillationStartInput) => {
    const refs = validateSessionRefs(input?.sessionRefs);
    const modelId =
      typeof input?.modelId === "string" && input.modelId.trim().length > 0
        ? input.modelId.trim()
        : undefined;
    const promptText =
      typeof input?.promptText === "string" &&
      input.promptText.trim().length > 0
        ? input.promptText.trim().slice(0, 4_000)
        : undefined;
    return {
      sessionRefs: refs,
      ...(modelId ? { modelId } : {}),
      ...(promptText ? { promptText } : {}),
    };
  })
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
    return {
      candidateId: input.candidateId,
      skillName: input.skillName.trim().slice(0, 64),
      targetAgent: input.targetAgent.trim(),
      ...(content ? { content } : {}),
    };
  })
  .handler(async ({ data }): Promise<DistillationSaveSkillResponse> => {
    const { saveCandidateAsSkill: run } = await import("./api.server.ts");
    return run(data);
  });
