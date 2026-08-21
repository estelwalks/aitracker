/**
 * Distillation transport adapter. Server-only: wires the composition root's
 * distillation application into the presentation read model and the
 * start/approve/cancel actions. Only renderer-safe projections cross this
 * boundary: session refs/titles/project/model/timestamps and candidate
 * summaries (already safety-filtered by the distillation domain). The raw
 * session content is never read or returned here.
 *
 * Candidates are persisted by the application through the composition root's
 * SQLite `CandidatePersistence` repository and hydrated on construction, so
 * `loadDistillation` can enumerate the full experiment history after a
 * navigation/refresh. Persisted candidates contain only session metadata and
 * the safety-filtered knowledge note — never raw conversation content.
 *
 * `saveCandidateAsSkill` is the only path that writes a generated knowledge
 * note into a tool's skill root. It requires an explicitly approved candidate
 * and a validated skill name + target agent; the write stays inside the
 * resolved agent root.
 */
import { mkdir, lstat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { promptForKind } from "./prompts.ts";
import { qualifySkillFiles, type SkillQualification } from "./qualify.ts";

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
    isGitProject: session.isGitProject,
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
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    await root.sessionSnapshot
      .requestRefresh({ reason: "manual" })
      .catch(() => undefined);
    const [page, candidates] = await Promise.all([
      root.sessions.query({ page: 1, pageSize: 100 }),
      root.distillation.listAll(),
    ]);
    const sessions = page.ok ? page.value.sessions.map(toItem) : [];
    const quota = await root.distillQuota
      .read()
      .then((current) => ({
        used: current.used,
        limit: current.limit,
        remaining: Math.max(0, current.limit - current.used),
      }))
      .catch(() => null);
    const profiles = await root.modelProfiles.listViews();
    const activeProfile = await root.modelProfiles.getActiveView();
    const seen = new Set<string>();
    const modelOptions: Array<{
      id: string;
      label: string;
      offline?: boolean;
      vendor?: string;
      sub?: string;
      official?: boolean;
      ok?: boolean;
    }> = [];
    for (const profile of profiles) {
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);
      modelOptions.push({
        id: profile.id,
        label: profile.name,
        vendor:
          profile.mode === "official"
            ? "官方"
            : profile.protocol === "anthropic"
              ? "Anthropic"
              : "OpenAI",
        sub: profile.model ?? profile.endpoint ?? "未配置",
        official: profile.mode === "official",
        ok:
          profile.mode === "official"
            ? quota != null && quota.remaining > 0
            : !!profile.endpoint,
      });
    }
    modelOptions.push({
      id: "offline",
      label: "offline",
      offline: true as const,
    });
    const activeModelId = activeProfile?.id ?? "offline";
    return {
      sessions,
      candidates,
      stats: {
        runs: candidates.length,
        approved: candidates.filter((item) => item.approvalState === "approved")
          .length,
      },
      modelOptions,
      activeModelId,
      quota,
    };
  } catch {
    return {
      sessions: [],
      candidates: [],
      stats: { runs: 0, approved: 0 },
      modelOptions: [{ id: "offline", label: "offline", offline: true }],
      activeModelId: "offline",
      quota: null,
    };
  }
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
  // The page forwards the selected model. When omitted, use the shared active
  // saved profile; with no profile configured, use the explicit offline mode.
  // A profile id must resolve through the server-only execution accessor before
  // routing to the profile-backed provider. Unknown/deleted ids are rejected
  // instead of silently fabricating a fallback result.
  const modelId =
    input.modelId?.trim() ||
    (await root.modelProfiles.getActiveView())?.id ||
    "offline";
  let providerId: string | undefined;
  if (modelId !== "offline") {
    const profile = await root.modelProfiles.getProfileForExecution(modelId);
    if (profile) providerId = "profile";
  }
  if (!providerId && modelId !== "offline")
    return { ok: false, errorCode: "errors.distillation.noModelConfigured" };
  const result = await root.distillation.start({
    requestId: `distill:${crypto.randomUUID()}`,
    selection: {
      sessionRefs: refs,
      ...(segments.length > 0 ? { segments } : {}),
    },
    modelId,
    kind: input.kind,
    providerId,
    prompt: {
      id: `distillation.${input.kind ?? "memory"}`,
      version: 2,
      template: promptForKind(input.kind, input.promptText),
    },
    timeoutMs: 120_000,
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

  const suppliedFiles = Array.isArray(input.files) ? input.files : [];
  const summary = input.content?.trim() || candidate.summary;
  const description = summary.split("\n")[0]?.slice(0, 120) ?? "";
  const fallbackSkill = [
    "---",
    `name: ${name}`,
    ...(description ? [`description: ${description}`] : []),
    "---",
    "",
    `# ${name}`,
    "",
    summary || `Distilled knowledge note (${name}).`,
    "",
  ].join("\n");
  const files = suppliedFiles.length
    ? suppliedFiles
    : [{ path: "SKILL.md", content: fallbackSkill }];
  const seenPaths = new Set<string>();
  const validated: Array<{ targetFile: string; content: string }> = [];
  for (const file of files) {
    const filePath = file.path?.trim();
    if (
      !filePath ||
      filePath.startsWith("/") ||
      filePath.includes("\\") ||
      seenPaths.has(filePath)
    )
      // A bad file path is client input, not a server failure — return a
      // translatable error instead of throwing a 500.
      return { ok: false, errorCode: "errors.distillation.invalidName" };
    const targetFile = join(targetDir, filePath);
    if (!isPathInside(targetDir, targetFile))
      return { ok: false, errorCode: "errors.distillation.invalidName" };
    seenPaths.add(filePath);
    validated.push({ targetFile, content: file.content });
  }
  if (!seenPaths.has("SKILL.md"))
    return { ok: false, errorCode: "errors.distillation.invalidName" };
  await mkdir(targetDir, { recursive: true, mode: 0o700 });
  for (const file of validated) {
    await mkdir(resolve(file.targetFile, ".."), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(file.targetFile, file.content, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  const skillPath = join(targetDir, "SKILL.md");
  // 生成后自动质检：对产物按候选 kind 应用对应规则，随保存结果返回。
  const qualification = qualifySkillFiles(
    validated.map((file) => ({
      path: relative(targetDir, file.targetFile),
      content: file.content,
    })),
    candidate.kind === "skill" ||
      candidate.kind === "prompt" ||
      candidate.kind === "brief"
      ? candidate.kind
      : "skill",
  );
  // Make the new package visible in Skill management immediately.
  await root.skillSnapshot.requestRefresh({ reason: "manual" }).catch(() => {});
  return {
    ok: true,
    agent: input.targetAgent,
    path: skillPath,
    qualification,
  };
}
