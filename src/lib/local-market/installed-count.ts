/** Structural slice shared by server and renderer install-count projections. */
export interface MarketInstalledSkillShape {
  readonly id: string;
  readonly installations: readonly {
    readonly source: { readonly kind: string } | null;
  }[];
}

/**
 * Counts distinct local Skills with at least one market-managed installation.
 * Installing one Skill into multiple agents still contributes one to the KPI.
 */
export function countInstalledMarketSkills(
  skills: readonly MarketInstalledSkillShape[],
): number {
  const ids = new Set<string>();
  for (const skill of skills) {
    if (
      skill.installations.some(
        (installation) => installation.source?.kind === "market",
      )
    ) {
      ids.add(skill.id);
    }
  }
  return ids.size;
}
