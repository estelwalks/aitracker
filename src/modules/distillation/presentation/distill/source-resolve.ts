import type { CandidateOutput } from "../../contracts.ts";
import type { DistillationSessionItem } from "../index.ts";

export interface ResolvedCandidateSource {
  readonly projectKeys: readonly string[];
  readonly sources: readonly string[];
  readonly sessionTitles: readonly string[];
}

export function resolveCandidateSource(
  candidate: CandidateOutput,
  sessions: readonly DistillationSessionItem[],
): ResolvedCandidateSource {
  const sessionMap = new Map(
    sessions.map((session) => [
      `${session.source}:${session.sessionId}`,
      session,
    ]),
  );
  const projects: string[] = [];
  const sources: string[] = [];
  const titles: string[] = [];

  for (const ref of candidate.selectedSessionRefs) {
    const item = sessionMap.get(`${ref.source}:${ref.sessionId}`);
    if (item) {
      if (!projects.includes(item.projectKey)) projects.push(item.projectKey);
      if (!sources.includes(item.source)) sources.push(item.source);
      if (!titles.includes(item.title)) titles.push(item.title);
      continue;
    }
    if (!sources.includes(ref.source)) sources.push(ref.source);
  }

  return {
    projectKeys: projects,
    sources,
    sessionTitles: titles,
  };
}
