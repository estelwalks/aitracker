import type { SessionStatus } from "../../sessions/contracts.ts";
import type { CandidateOutput } from "../contracts.ts";

/** Browser-safe projection of a selectable session. No paths, no content. */
export interface DistillationSessionItem {
  readonly source: string;
  readonly sessionId: string;
  readonly title: string;
  readonly projectKey: string;
  /** True when the session's project is a real git repository root (not a
   *  plain folder). Only git-backed projects appear under "by project". */
  readonly isGitProject?: boolean;
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
   * Complete privacy-safe experiment history, hydrated from the persisted
   * candidate store (waiting, approved and cancelled; newest first).
   */
  readonly candidates: readonly CandidateOutput[];
  /** Workbench counters derived from the persisted candidate store. */
  readonly stats: { readonly runs: number; readonly approved: number };
  /**
   * Real model options for the pro-mode model picker. Derived from the
   * saved S-500 model profiles (never the API key) plus the deterministic
   * offline fallback. Always contains at least `offline`.
   */
  readonly modelOptions: readonly {
    id: string;
    label: string;
    offline?: boolean;
    /** Vendor group shown in the picker dropdown header (官方 / Anthropic / …). */
    vendor?: string;
    /** Secondary mono text under the model name (model or endpoint). */
    sub?: string;
    /** True for the official-mode profile; only official models gate on quota. */
    official?: boolean;
    /** True when the profile has a usable endpoint (status dot). */
    ok?: boolean;
  }[];
  /**
   * The server-resolved preferred real model for new runs. This tracks the
   * active S-500 profile when one exists; otherwise it is `offline`.
   */
  readonly activeModelId?: string;
  /**
   * Server-side daily quota for real-model distillation calls (Story B-600).
   * `null` when the quota ledger is unavailable; the UI then falls back to
   * the "offline runs don't consume quota" hint. The count is authoritative
   * on the server — the renderer only ever reads this projection.
   */
  readonly quota: {
    readonly used: number;
    readonly limit: number;
    /** Calls still available today (`max(0, limit - used)`). */
    readonly remaining: number;
  } | null;
}

export interface DistillationStartInput {
  /** Opaque session refs to distill from (no duplicates). */
  readonly sessionRefs: ReadonlyArray<{
    readonly source: string;
    readonly sessionId: string;
  }>;
  /**
   * Optional user-selected transcript segments (Story B-100). Each segment
   * references a session already present in `sessionRefs` plus an inclusive
   * 0-based message window; the referenced text is used only for the current
   * AI request (in memory) and never persisted.
   */
  readonly segments?: ReadonlyArray<{
    readonly source: string;
    readonly sessionId: string;
    readonly startIndex: number;
    readonly endIndex: number;
  }>;
  /** Optional model id; defaults to the shared active profile or offline. */
  readonly modelId?: string;
  /** Optional custom prompt template; defaults to the built-in summary prompt. */
  readonly promptText?: string;
  /** Output kind this run should produce (prototype 出产物). Absent → memory. */
  readonly kind?: "memory" | "brief" | "prompt" | "persona" | "skill";
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
  /** Complete generated package. Paths are validated below the target root. */
  readonly files?: ReadonlyArray<{
    readonly path: string;
    readonly content: string;
  }>;
}

export interface DistillationSaveSkillResponse {
  readonly ok: boolean;
  readonly errorCode?: string;
  readonly agent?: string;
  /** Resolved SKILL.md path on success (already normalized). */
  readonly path?: string;
  /** 保存时对产物做的自动质检结果。 */
  readonly qualification?: import("../qualify.ts").SkillQualification;
}

export type { CandidateOutput };
