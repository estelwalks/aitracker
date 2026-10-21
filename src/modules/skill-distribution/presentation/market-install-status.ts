import type { LocalSkill } from "../../skill-catalog/query/contracts.ts";

/**
 * Market install-status matching.
 *
 * A market install records the repository (`owner/name`) as its source label,
 * which is repo-level, not Skill-level: `openclaw/openclaw` ships dozens of
 * Skills, so matching on the label alone lit up every sibling Skill after one
 * install. The installed folder name is the Skill-level half of the identity —
 * the market installer copies the folder that holds `SKILL.md`, projected to
 * the renderer as `installDirectory` — so the pair
 * `repo label + installed folder` identifies exactly one market Skill.
 *
 * The local SKILL.md name is the fallback for snapshots written before the
 * directory name was persisted, but only within the same repository so a
 * same-named Skill from another repo can never borrow the status.
 */

/** Installed agents for one market Skill; absent keys mean "not installed". */
export type MarketInstalledAgents = Readonly<Record<string, boolean>>;

export interface MarketRepoInstallIndex {
  /** Installed folder name inside the agent's Skill root. */
  readonly byDirectory: ReadonlyMap<string, MarketInstalledAgents>;
  /** Local SKILL.md name, scoped to this repository. */
  readonly byName: ReadonlyMap<string, MarketInstalledAgents>;
}

/** Repository label (`owner/name`) → installs recorded from that repository. */
export type MarketInstallIndex = ReadonlyMap<string, MarketRepoInstallIndex>;

/** Renderer-visible identity of a market Skill. */
export interface MarketSkillIdentity {
  readonly name: string;
  readonly repoOwner: string;
  readonly repoName: string;
  /** Folder the installer copies, derived server-side from the repo path. */
  readonly installDirectory: string;
}

const EMPTY_INSTALLED: MarketInstalledAgents = {};

function repoLabel(skill: Pick<MarketSkillIdentity, "repoOwner" | "repoName">) {
  return `${skill.repoOwner}/${skill.repoName}`;
}

function mergeAgent(
  current: MarketInstalledAgents | undefined,
  agent: string,
): MarketInstalledAgents {
  return { ...current, [agent]: true };
}

/**
 * Builds the lookup once per local snapshot. Only market-sourced installations
 * participate: an unrelated local Skill that happens to share a name must not
 * claim a market row.
 */
export function buildMarketInstallIndex(
  skills: readonly LocalSkill[],
): MarketInstallIndex {
  const byRepo = new Map<
    string,
    {
      byDirectory: Map<string, MarketInstalledAgents>;
      byName: Map<string, MarketInstalledAgents>;
    }
  >();
  for (const skill of skills) {
    for (const installation of skill.installations) {
      const source = installation.source;
      if (source?.kind !== "market") continue;
      const label = source.label.trim();
      if (label === "") continue;
      const repo = byRepo.get(label) ?? {
        byDirectory: new Map<string, MarketInstalledAgents>(),
        byName: new Map<string, MarketInstalledAgents>(),
      };
      byRepo.set(label, repo);

      repo.byName.set(
        skill.name,
        mergeAgent(repo.byName.get(skill.name), installation.agent),
      );
      const directory = installation.directoryName?.trim();
      if (directory == null || directory === "") continue;
      repo.byDirectory.set(
        directory,
        mergeAgent(repo.byDirectory.get(directory), installation.agent),
      );
    }
  }
  return byRepo;
}

/** Resolves which agents have this market Skill installed. */
export function marketInstalledAgents(
  index: MarketInstallIndex,
  skill: MarketSkillIdentity,
): MarketInstalledAgents {
  const repo = index.get(repoLabel(skill));
  if (repo == null) return EMPTY_INSTALLED;
  return (
    repo.byDirectory.get(skill.installDirectory) ??
    repo.byName.get(skill.name) ??
    EMPTY_INSTALLED
  );
}
