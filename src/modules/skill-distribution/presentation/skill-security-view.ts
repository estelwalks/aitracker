import type { SecurityHistoryView } from "../../security-assessment/index.ts";
import { skillIdentityNames } from "../../skill-catalog/index.ts";
import type { LocalSkill } from "../../skill-catalog/query/contracts.ts";

export function projectSkillSecurityView(
  skills: readonly LocalSkill[],
  history: readonly SecurityHistoryView[],
): { readonly byName: ReadonlyMap<string, number> } {
  const catalogNameByIdentity = new Map<string, string>();
  for (const skill of skills) {
    for (const identity of skillIdentityNames(skill)) {
      catalogNameByIdentity.set(identity, skill.name);
    }
  }

  const byName = new Map<string, number>();
  const latestFinishedAt = new Map<string, string>();
  for (const entry of history) {
    const catalogName = catalogNameByIdentity.get(entry.skillName);
    if (!catalogName || !entry.report) continue;
    const previous = latestFinishedAt.get(catalogName);
    if (previous && Date.parse(previous) >= Date.parse(entry.finishedAt)) {
      continue;
    }
    latestFinishedAt.set(catalogName, entry.finishedAt);
    byName.set(catalogName, entry.report.findings.length);
  }
  return { byName };
}
