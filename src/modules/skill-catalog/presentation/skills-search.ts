/** Keep the local Skill filter and its deep-link query parameter in sync. */
export function withSkillSearch<T extends { skill?: string }>(
  previous: T,
  value: string,
): T {
  const next = { ...previous };
  delete next.skill;
  const skill = value.trim();
  if (skill) next.skill = skill;
  return next;
}
