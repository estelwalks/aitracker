import type { SessionStatus } from "../../sessions/contracts.ts";
import type { CandidateOutput } from "../contracts.ts";

/** Browser-safe projection of a selectable session. No paths, no content. */
export interface DistillationSessionItem {
  readonly source: string;
  readonly sessionId: string;
  readonly title: string;
  readonly projectKey: string;
  readonly model: string | null;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly turns: number;
  readonly status: SessionStatus;
}

export interface DistillationViewModel {
  /** Sessions available for selection; may be empty when no local sessions exist. */
  readonly sessions: readonly DistillationSessionItem[];
  /** Candidates awaiting approval, hydrated from the persisted candidate store. */
  readonly candidates: readonly CandidateOutput[];
  /** Workbench counters derived from the persisted candidate store. */
  readonly stats: { readonly runs: number; readonly approved: number };
  /**
   * Real model options for the pro-mode model picker. Derived from the
   * configured LLM env (never the API key) plus the deterministic offline
   * fallback. Always contains at least `offline`.
   */
  readonly modelOptions: readonly {
    id: string;
    label: string;
    offline?: boolean;
  }[];
}

export interface DistillationStartInput {
  /** Opaque session refs to distill from (max 8, no duplicates). */
  readonly sessionRefs: ReadonlyArray<{
    readonly source: string;
    readonly sessionId: string;
  }>;
  /** Optional model id; defaults to the offline model when omitted. */
  readonly modelId?: string;
  /** Optional custom prompt template; defaults to the built-in summary prompt. */
  readonly promptText?: string;
}

export interface DistillationStartResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly candidate?: CandidateOutput;
}

export interface DistillationActionResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly candidate?: CandidateOutput;
}

export interface DistillationSaveSkillInput {
  /** Approved candidate to write as a local Skill. */
  readonly candidateId: string;
  /** Skill directory name (single path segment, no separators). */
  readonly skillName: string;
  /** Target skill agent label (from the shared SKILL_AGENTS list). */
  readonly targetAgent: string;
  /**
   * Optional edited SKILL.md body. When omitted the server uses the approved
   * candidate's safety-filtered summary.
   */
  readonly content?: string;
}

export interface DistillationSaveSkillResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly agent?: string;
  /** Resolved SKILL.md path on success (already normalized). */
  readonly path?: string;
}

export type { CandidateOutput };
