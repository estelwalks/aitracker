import type { MessageKey } from "../../../../lib/i18n/messages";
import type { CandidateOutput } from "../../contracts.ts";

/**
 * Output-type catalog aligned with the reference design's OUT_TYPES/OUT_GROUPS
 * (prototype `lib/distill-kinds.ts`: 5 types in 2 groups), mapped onto the
 * existing candidate `kind` contract:
 *
 *   capability (→ Skill library): skill→skill, workflow→brief, prompt→prompt
 *   memory (→ memory library):    profile→persona, task→memory
 *
 * The transport does not carry the selected output type yet, so the chosen
 * type reaches the model through the prompt directive (`instructionKey`)
 * instead. The candidate badge always comes from the real persisted
 * `candidate.kind` via `kindMeta` — never from this selection.
 */
export type OutTypeId = "skill" | "workflow" | "prompt" | "profile" | "task";
export type OutGroupId = "capability" | "memory";
export type OutCandidateKind = CandidateOutput["kind"];

export interface OutTypeMeta {
  readonly id: OutTypeId;
  readonly group: OutGroupId;
  readonly labelKey: MessageKey;
  readonly hintKey: MessageKey;
  /** Directive injected into the run prompt when this type is selected. */
  readonly instructionKey: MessageKey;
  readonly color: string;
  /** Candidate kind this output type maps onto. */
  readonly kind: OutCandidateKind;
}

export const OUT_GROUPS: readonly {
  readonly id: OutGroupId;
  readonly labelKey: MessageKey;
  readonly destKey: MessageKey;
}[] = [
  {
    id: "capability",
    labelKey: "distill.outGroupCapability",
    destKey: "distill.outDestSkill",
  },
  {
    id: "memory",
    labelKey: "distill.outGroupMemory",
    destKey: "distill.outDestMemory",
  },
];

export const OUT_TYPES: readonly OutTypeMeta[] = [
  {
    id: "skill",
    group: "capability",
    kind: "skill",
    labelKey: "distill.outSkill",
    hintKey: "distill.outSkillHint",
    instructionKey: "distill.outSkillInstr",
    color: "var(--chart-1)",
  },
  {
    id: "workflow",
    group: "capability",
    kind: "brief",
    labelKey: "distill.outWorkflow",
    hintKey: "distill.outWorkflowHint",
    instructionKey: "distill.outWorkflowInstr",
    color: "var(--chart-3)",
  },
  {
    id: "prompt",
    group: "capability",
    kind: "prompt",
    labelKey: "distill.outPrompt",
    hintKey: "distill.outPromptHint",
    instructionKey: "distill.outPromptInstr",
    color: "var(--chart-4)",
  },
  {
    id: "profile",
    group: "memory",
    kind: "persona",
    labelKey: "distill.outProfile",
    hintKey: "distill.outProfileHint",
    instructionKey: "distill.outProfileInstr",
    color: "var(--chart-2)",
  },
  {
    id: "task",
    group: "memory",
    kind: "memory",
    labelKey: "distill.outTask",
    hintKey: "distill.outTaskHint",
    instructionKey: "distill.outTaskInstr",
    color: "var(--chart-5)",
  },
];

export function outTypeMeta(id: OutTypeId): OutTypeMeta {
  return OUT_TYPES.find((meta) => meta.id === id) ?? OUT_TYPES[0];
}

/** Memory-library output types (portrait / task memory). */
export function isMemoryKind(kind: OutCandidateKind): boolean {
  return kind === "persona" || kind === "memory";
}

/** Kind badge metadata keyed by the real persisted candidate kind. */
export function kindMeta(kind: OutCandidateKind): {
  readonly labelKey: MessageKey;
  readonly color: string;
} {
  switch (kind) {
    case "skill":
      return { labelKey: "distill.outSkill", color: "var(--chart-1)" };
    case "brief":
      return { labelKey: "distill.outWorkflow", color: "var(--chart-3)" };
    case "prompt":
      return { labelKey: "distill.outPrompt", color: "var(--chart-4)" };
    case "persona":
      return { labelKey: "distill.outProfile", color: "var(--chart-2)" };
    case "memory":
      return { labelKey: "distill.outTask", color: "var(--chart-5)" };
  }
}
