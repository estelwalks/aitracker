/**
 * The folder a market Skill is installed under inside an agent's Skill root.
 *
 * `repoPath` points at the Skill's `SKILL.md` inside its repository, and the
 * installer copies the folder that holds it (`findSkillRoot` selects it,
 * `copySkillToAgent` names the install after its basename). The catalog slug is
 * not always the folder name — `antd-create-pr` lives in `create-pr`,
 * `agent-reach` in `skill` — so the parent segment wins and the slug is only
 * the fallback for a repository-root `SKILL.md`.
 *
 * Only this leaf name is projected to the renderer; the repository path itself
 * never leaves the server.
 */
export function marketSkillInstallDirectory(
  repoPath: string | null | undefined,
  slug: string,
): string {
  const segments = (repoPath ?? "")
    .replace(/\\/gu, "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  return segments.length >= 2 ? segments[segments.length - 2]! : slug;
}
