import type { LocalSkill } from "../query/contracts.ts";

/** Safe, renderer-visible directory identities for every installed copy. */
export function skillDirectoryNames(skill: LocalSkill): readonly string[] {
  return [
    ...new Set(
      skill.installations
        .map((installation) => installation.directoryName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

/** Directory identity is primary; the manifest name is a fallback only. */
export function primarySkillDirectoryName(skill: LocalSkill): string {
  return skillDirectoryNames(skill)[0] ?? skill.name;
}

/**
 * Show both identities only when they differ, e.g. `binary-payload (bundle)`.
 */
export function formatSkillDisplayName(
  skill: LocalSkill,
  directoryName = primarySkillDirectoryName(skill),
): string {
  const directory = directoryName.trim() || skill.name;
  const manifest = skill.name.trim();
  return manifest && manifest !== directory
    ? `${directory} (${manifest})`
    : directory;
}

/** Names that may be emitted by catalog and security discovery respectively. */
export function skillIdentityNames(skill: LocalSkill): readonly string[] {
  return [...new Set([...skillDirectoryNames(skill), skill.name])];
}
