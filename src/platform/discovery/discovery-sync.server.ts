/**
 * Cross-domain agent-discovery synchronization.
 *
 * The snapshot domains refresh on independent cadences — usage/sessions every
 * 5 minutes, skills every 30 minutes, installation probes every hour — so a
 * freshly installed agent converges at different speeds per domain: the
 * session/usage pages show it within minutes, while the installation snapshot
 * (Sources status, Agent overview, install gating) keeps serving "not
 * installed" until its next probe commits and the skill catalog waits for its
 * half-hour cadence. This module holds the pure decision logic that turns
 * parsed evidence into cross-domain refresh requests: parsed usage/session
 * evidence names tools whose installation fact is missing or stale-false
 * (queue an installation probe), and a committed probe that newly installs a
 * skill-capable agent asks for a skills rescan. The composition root wires
 * these decisions into the usage/sessions/installation refresh executors;
 * nothing here touches the task runtime or the filesystem.
 */
import { SKILL_AGENT_RULES } from "../../lib/local-skills/skill-rules.server.ts";
import type { InstallationFactData } from "./installation-snapshot.contracts.ts";

/** Minimum gap between evidence-triggered installation probes (ms). */
export const DISCOVERY_PROBE_MIN_INTERVAL_MS = 15 * 60 * 1_000;

/** Minimal structural input: a per-source usage summary row. */
export interface UsageEvidenceSource {
  readonly source: string;
  readonly available?: boolean;
  readonly detected?: boolean;
  readonly events?: number;
}

/**
 * Tool ids whose usage summary proves a real installation (mirrors the
 * "inferred installed" predicate of the Sources projection): either a
 * detected log root or parsed events.
 */
export function usageEvidenceToolIds(
  sources: readonly UsageEvidenceSource[],
): string[] {
  return sources
    .filter(
      (source) =>
        source.detected === true ||
        (source.available === true && (source.events ?? 0) > 0),
    )
    .map((source) => source.source);
}

/** Distinct tool ids that produced at least one session record. */
export function sessionEvidenceToolIds(
  sessions: readonly { readonly source: string }[],
): string[] {
  return [...new Set(sessions.map((session) => session.source))];
}

/**
 * Evidence tool ids that the current installation facts do not (yet) mark
 * installed. A tool with no fact row at all counts as missing — the snapshot
 * may predate both the probe and the install.
 */
export function toolsMissingInstallationFact(
  evidenceToolIds: readonly string[],
  facts: readonly InstallationFactData[],
): string[] {
  if (evidenceToolIds.length === 0) return [];
  const installedById = new Map(
    facts.map((fact) => [fact.id, fact.installed] as const),
  );
  return evidenceToolIds.filter((id) => installedById.get(id) !== true);
}

/**
 * Whether an evidence-triggered installation probe should run. Probing is
 * cheap but writes a snapshot generation, so a persistent mismatch (e.g.
 * sessions found inside a WSL distro whose host root can never probe) must
 * not re-probe on every usage/session tick: after a successful probe, wait
 * at least `minIntervalMs` before probing the same mismatch again.
 */
export function shouldRequestInstallationProbe(options: {
  readonly missingToolIds: readonly string[];
  /** Last successful probe time; null when no probe has ever committed. */
  readonly lastProbeSuccessAtMs: number | null;
  readonly nowMs: number;
  readonly minIntervalMs?: number;
}): boolean {
  if (options.missingToolIds.length === 0) return false;
  if (options.lastProbeSuccessAtMs == null) return true;
  const minIntervalMs =
    options.minIntervalMs ?? DISCOVERY_PROBE_MIN_INTERVAL_MS;
  return options.nowMs - options.lastProbeSuccessAtMs >= minIntervalMs;
}

/**
 * Tool ids that flipped from not-installed to installed between two
 * installation snapshots. Unknown history (`previous == null`, e.g. the very
 * first probe after a data reset) reports nothing new rather than guessing.
 */
export function newlyInstalledToolIds(
  previous: readonly InstallationFactData[] | null,
  next: readonly InstallationFactData[],
): string[] {
  if (previous == null) return [];
  const previouslyInstalled = new Set(
    previous.filter((fact) => fact.installed).map((fact) => fact.id),
  );
  return next
    .filter((fact) => fact.installed && !previouslyInstalled.has(fact.id))
    .map((fact) => fact.id);
}

/**
 * Catalog tool ids whose installations carry discoverable skill roots (the
 * same server-side rules the skill scanner walks). A newly installed agent
 * outside this set has no skills to rescan.
 */
export const SKILL_AGENT_TOOL_IDS: ReadonlySet<string> = new Set(
  SKILL_AGENT_RULES.map((rule) => rule.toolId),
);
