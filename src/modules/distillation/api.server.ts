/**
 * Distillation transport adapter. Server-only: wires the composition root's
 * distillation application into the presentation read model and the
 * start/approve/cancel actions. Only renderer-safe projections cross this
 * boundary: session refs/titles/project/model/timestamps and candidate
 * summaries (already safety-filtered by the distillation domain). The raw
 * session content is never read or returned here.
 *
 * Candidates are persisted by the application through an injected
 * `CandidatePersistence` store (`~/.trusttools/tasks/distill-candidates.v1.json`)
 * and hydrated on construction, so `loadDistillation` can enumerate the full
 * experiment history after a navigation/refresh. Persisted candidates contain
 * only session metadata and the safety-filtered knowledge note — never raw
 * conversation content.
 *
 * `saveCandidateAsSkill` is the only path that writes a generated knowledge
 * note into a tool's skill root. It requires an explicitly approved candidate
 * and a validated skill name + target agent; the write stays inside the
 * resolved agent root.
 */
import { mkdir, lstat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";

import type { Locale } from "../../lib/i18n/locale.ts";
import type { SessionSummary } from "../sessions/contracts.ts";
import type {
  DistillationActionResponse,
  DistillationSaveSkillInput,
  DistillationSaveSkillResponse,
  DistillationSessionItem,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel,
} from "./presentation/index.ts";

export type {
  DistillationActionResponse,
  DistillationSaveSkillInput,
  DistillationSaveSkillResponse,
  DistillationSessionItem,
  DistillationStartInput,
  DistillationStartResponse,
  DistillationViewModel as DistillationLoadResult,
};

function toItem(session: SessionSummary): DistillationSessionItem {
  return {
    source: session.source,
    sessionId: session.sessionId,
    title: session.title,
    projectKey: session.projectKey,
    model: session.model,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    turns: session.turns,
    status: session.status,
  };
}

/**
 * Load the distillation workbench read model. Resolves the selectable sessions
 * from the composition root's shared session port, the complete persisted
 * candidate history, the real model options from the saved S-500 model
 * profiles and the server-side daily quota projection for real-model calls
 * (Story B-600). The same `listAll` snapshot powers both candidate cards and
 * counters, avoiding inconsistent or duplicate persistence reads. `locale` is
 * accepted for transport parity; the projection is locale-neutral.
 */
export async function loadDistillation(
  _locale: Locale,
): Promise<DistillationViewModel> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const [page, candidates] = await Promise.all([
    root.sessions.query({ page: 1, pageSize: 100 }),
    root.distillation.listAll(),
  ]);
  const sessions = page.ok ? page.value.sessions.map(toItem) : [];
  // The quota ledger is authoritative on the server; the renderer only reads
  // this remaining-count projection. A failing read degrades to `null` — the
  // workbench keeps working and shows the offline hint instead.
  const quota = await root.distillQuota
    .read()
    .then((current) => ({
      used: current.used,
      limit: current.limit,
      remaining: Math.max(0, current.limit - current.used),
    }))
    .catch(() => null);
  const { getModelProfileRepository } =
    await import("../ai-orchestration/model-profile.server.ts");
  const profiles = await getModelProfileRepository().listViews();
  // Saved S-500 profiles first (id + label=name), then the deterministic
  // offline fallback. Ids are de-duplicated across profiles.
  const seen = new Set<string>();
  const modelOptions: Array<{
    id: string;
    label: string;
    offline?: boolean;
  }> = [];
  for (const profile of profiles) {
    if (seen.has(profile.id)) continue;
    seen.add(profile.id);
    modelOptions.push({ id: profile.id, label: profile.name });
  }
  modelOptions.push({
    id: "offline",
    label: "offline",
    offline: true as const,
  });
  return {
    sessions,
    candidates,
    stats: {
      runs: candidates.length,
      approved: candidates.filter((item) => item.approvalState === "approved")
        .length,
    },
    modelOptions,
    quota,
  };
}

/**
 * Start a distillation run. Validates the selection, delegates to the
 * application's `start` (which sanitises session metadata before invoking the
 * model), and returns the privacy-safe candidate. Optional user-selected
 * transcript segments are forwarded as-is: the application loads them into
 * memory for the AI request only — never returned here, never persisted.
 */
export async function startDistillation(
  input: DistillationStartInput,
): Promise<DistillationStartResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const refs = Array.isArray(input?.sessionRefs) ? input.sessionRefs : [];
  const segments = Array.isArray(input?.segments) ? input.segments : [];
  const modelId = input.modelId?.trim() || "offline";
  // When the selected model is a saved S-500 profile, route the request to the
  // composition root's profile-backed provider (providerId "profile") so the
  // real endpoint/key are used server-side. Unknown ids (offline or deleted
  // profiles) keep the registry/offline behaviour.
  let providerId: string | undefined;
  if (modelId !== "offline") {
    const profile = await root.modelProfiles.getProfileForExecution(modelId);
    if (profile) providerId = "profile";
  }
  const result = await root.distillation.start({
    requestId: `distill:${crypto.randomUUID()}`,
    selection: {
      sessionRefs: refs,
      ...(segments.length > 0 ? { segments } : {}),
    },
    modelId,
    providerId,
    prompt: {
      id: "distillation.summary",
      version: 1,
      template:
        input.promptText?.trim() ||
        "Summarise the selected sessions' metadata into a concise knowledge note.",
    },
  });
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}

/**
 * Approve a waiting candidate. This is the only path that creates and
 * approves a knowledge draft. Returns the updated candidate.
 */
export async function approveCandidate(
  candidateId: string,
  actor = "user",
): Promise<DistillationActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.distillation.approve(candidateId, actor);
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}

/**
 * Cancel a waiting candidate. No knowledge draft is created or modified.
 */
export async function cancelCandidate(
  candidateId: string,
): Promise<DistillationActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.distillation.cancel(candidateId);
  if (!result.ok) return { ok: false, errorCode: result.error.code };
  return { ok: true, candidate: result.value.candidate };
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !pathFromRoot.split(sep).includes("..")
  );
}

function validSkillName(name: string): boolean {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed !== "." &&
    trimmed !== ".." &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\") &&
    basename(trimmed) === trimmed &&
    trimmed.length <= 64
  );
}

/**
 * Save an approved candidate's knowledge note as a local Skill. Writes
 * `<agentRoot>/<name>/SKILL.md` into the target tool's skill root (the same
 * roots the `/skills` scanner walks), so the Skill appears on the skills page
 * and can be synced to other tools there.
 *
 * Privacy: the body is the candidate's safety-filtered `summary` — the raw
 * conversation content is never read.
 */
export async function saveCandidateAsSkill(
  input: DistillationSaveSkillInput,
): Promise<DistillationSaveSkillResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const candidate = await root.distillation.get(input.candidateId);
  if (!candidate)
    return { ok: false, errorCode: "errors.distillation.notFound" };
  if (candidate.approvalState !== "approved")
    return { ok: false, errorCode: "errors.distillation.notApproved" };
  if (!validSkillName(input.skillName))
    return { ok: false, errorCode: "errors.distillation.invalidName" };
  const { SKILL_AGENTS } = await import("../../lib/local-skills/types.ts");
  if (!SKILL_AGENTS.includes(input.targetAgent))
    return { ok: false, errorCode: "errors.distillation.invalidAgent" };

  const { ENV } = await import("../../lib/app-config.ts");
  const { resolveAgentRoots } =
    await import("../../lib/local-skills/scanner.server.ts");
  // `TRUSTTOOLS_USAGE_HOME` mirrors the composition root's data-root override
  // (and keeps the write testable in isolation); unset → the real home.
  const home = process.env[ENV.USAGE_HOME] ?? homedir();
  const roots = resolveAgentRoots(home, process.env);
  const agentRoot = roots[input.targetAgent]?.[0];
  if (!agentRoot)
    return { ok: false, errorCode: "errors.distillation.invalidAgent" };

  const name = input.skillName.trim();
  const targetDir = join(agentRoot, name);
  if (!isPathInside(agentRoot, targetDir))
    return { ok: false, errorCode: "errors.distillation.invalidName" };

  // Refuse to overwrite an existing Skill directory (mirrors the scanner's
  // `duplicateName` conflict policy).
  const exists = await lstat(targetDir)
    .then(() => true)
    .catch(() => false);
  if (exists)
    return { ok: false, errorCode: "errors.distillation.skillExists" };

  // An edited draft overrides the approved summary for the Skill body; the
  // approved knowledge entry is never modified by this write.
  const summary = input.content?.trim() || candidate.summary;
  const description = summary.split("\n")[0]?.slice(0, 120) ?? "";
  const body = summary || `Distilled knowledge note (${name}).`;
  const content = [
    "---",
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    "---",
    "",
    `# ${name}`,
    "",
    body,
    "",
  ].join("\n");

  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  const skillPath = join(targetDir, "SKILL.md");
  await writeFile(skillPath, content, { encoding: "utf8", mode: 0o600 });
  return { ok: true, agent: input.targetAgent, path: skillPath };
}
