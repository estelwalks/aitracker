import type { LocalSkill } from "../query";
import type { SecuritySkillView } from "../../security-assessment/index.ts";
import { skillDirectoryNames } from "../application/skill-identity.ts";

/**
 * Security discovery identifies a trusted installation by its directory name,
 * while the catalog intentionally displays the manifest's `name`. Prefer the
 * installation identity so renamed manifests (for example `binary-payload`
 * declaring `name: bundle`) still resolve to an opaque security target.
 */
export function findSecurityTargetForSkill(
  skill: LocalSkill,
  targets: readonly SecuritySkillView[],
): SecuritySkillView | undefined {
  const directoryNames = new Set(skillDirectoryNames(skill));
  const directoryTarget = targets.find((target) =>
    directoryNames.has(target.name),
  );
  return (
    directoryTarget ?? targets.find((target) => target.name === skill.name)
  );
}
