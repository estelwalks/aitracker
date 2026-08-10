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
  /**
   * Always empty for now: the application keeps candidates in memory and
   * exposes no list API. The UI renders an honest explanation instead of a
   * candidate list.
   */
  readonly candidates: readonly never[];
}

export interface DistillationStartInput {
  /** Opaque session refs to distill from (max 8, no duplicates). */
  readonly sessionRefs: ReadonlyArray<{
    readonly source: string;
    readonly sessionId: string;
  }>;
  /** Optional model id; defaults to the offline model when omitted. */
  readonly modelId?: string;
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

export type { CandidateOutput };
