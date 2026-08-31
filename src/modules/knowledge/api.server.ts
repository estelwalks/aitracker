/**
 * Knowledge transport adapter for the memory hub. Server-only: wires the
 * composition root's knowledge repository into the renderer-safe memory read
 * model and the create/update/archive actions. Only privacy-safe projections
 * cross this boundary — asset metadata, provenance summaries, and the memory
 * body. The knowledge module hashes raw content on write and never persists
 * conversation content (CLEAN_ROOM); the ONLY persisted body is the
 * AI-distilled / manually entered memory product itself (`persistContent`),
 * which the hub card and Markdown export show in full.
 *
 * Manual entries store their display metadata in provenance `sourceRef`s:
 * - `manual:<source>`  — the user-typed source tool name
 * - `type:<profile|task>` — the memory type (profile/task memory)
 * - `project:<name>`   — optional project, when provided
 * Distilled entries keep `sourceType: "session"` provenance and are projected
 * with `source: "distill"` / `origin: "distill"`.
 */
import type {
  KnowledgeRepository,
  KnowledgeVersion,
  Provenance,
  ProvenanceRef,
} from "./contracts.ts";
import type {
  MemoryActionResponse,
  MemoryCreateInput,
  MemoryEntry,
  MemoryListResult,
  MemoryUpdateInput,
} from "./presentation/index.ts";

/** Minimal composition surface the transport needs (keeps tests root-free). */
export interface KnowledgeScope {
  readonly knowledge: KnowledgeRepository;
}

export type {
  MemoryActionResponse,
  MemoryCreateInput,
  MemoryEntry,
  MemoryListResult,
  MemoryUpdateInput,
};

const DISTILL_SOURCE = "distill" as const;
const UNKNOWN_SOURCE = "unknown" as const;
const PREFIX_MANUAL = "manual:";
const PREFIX_TYPE = "type:";
const PREFIX_PROJECT = "project:";

const ref = (value: string): ProvenanceRef => value as unknown as ProvenanceRef;

const findPrefix = (
  provenance: readonly Provenance[],
  prefix: string,
): Provenance | undefined =>
  provenance.find((item) => item.sourceRef.startsWith(prefix));

const decodeAfter = (item: Provenance | undefined, prefix: string): string =>
  item ? item.sourceRef.slice(prefix.length) : "";

function toMemoryError(code: string): string {
  switch (code) {
    case "errors.knowledge.notFound":
      return "errors.memory.notFound";
    case "errors.knowledge.conflict":
      return "errors.memory.conflict";
    case "errors.knowledge.invalidTransition":
      return "errors.memory.invalidTransition";
    default:
      return "errors.memory.writeFailed";
  }
}

function provenanceFor(input: MemoryCreateInput, now: string): Provenance[] {
  const source = input.source?.trim() || "manual";
  const summary = input.body.slice(0, 200);
  const rows: Provenance[] = [
    {
      sourceRef: ref(`${PREFIX_MANUAL}${source}`),
      sourceType: "manual",
      capturedAt: now,
      summary,
    },
    {
      sourceRef: ref(`${PREFIX_TYPE}${input.type}`),
      sourceType: "manual",
      capturedAt: now,
    },
  ];
  const project = input.project?.trim();
  if (project) {
    rows.push({
      sourceRef: ref(`${PREFIX_PROJECT}${project}`),
      sourceType: "manual",
      capturedAt: now,
    });
  }
  return rows;
}

/**
 * Pure projection of a knowledge version into the renderer-safe memory entry.
 * `source` derives from the first provenance's `sourceType` (session → the
 * "distill" token; manual → the decoded `manual:<source>` name), `body` is the
 * persisted memory product (falling back to the provenance summary for legacy
 * rows), and `origin` marks session-sourced entries as distilled. Never
 * returns conversation content.
 */
export function toMemoryEntry(version: KnowledgeVersion): MemoryEntry {
  const first = version.provenance[0];
  const isDistill = first?.sourceType === "session";
  const manual = findPrefix(version.provenance, PREFIX_MANUAL);
  const typeItem = findPrefix(version.provenance, PREFIX_TYPE);
  const projectItem = findPrefix(version.provenance, PREFIX_PROJECT);
  const decodedType = decodeAfter(typeItem, PREFIX_TYPE);
  return {
    assetId: version.assetId,
    title: version.title,
    kind: "memory",
    status: version.status,
    type:
      decodedType === "task"
        ? "task"
        : version.kind === "brief"
          ? "task"
          : "profile",
    source: isDistill
      ? DISTILL_SOURCE
      : decodeAfter(manual, PREFIX_MANUAL) ||
        first?.sourceType ||
        UNKNOWN_SOURCE,
    project: projectItem ? decodeAfter(projectItem, PREFIX_PROJECT) : undefined,
    summary: first?.summary ?? "",
    body: version.content ?? first?.summary ?? "",
    origin: isDistill ? "distill" : "manual",
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

/**
 * P4-T4-03: list memory-kind assets with their latest versions, newest
 * first, from ONE repository read (no per-asset `get()` N+1). Archived
 * (soft-deleted) assets and never-approved drafts are excluded so the hub
 * only shows live memories. The first screen is capped at 50 entries; the
 * DTO reports the exact totals so the UI never re-counts a partial page.
 */
export const MEMORY_FIRST_SCREEN_LIMIT = 50;

export async function listMemoryAssetsFrom(
  scope: KnowledgeScope,
): Promise<MemoryListResult & { hasMore: boolean }> {
  const listed = await scope.knowledge.listVersions({ kind: "memory" });
  if (!listed.ok)
    return {
      entries: [],
      counts: { total: 0, profile: 0, task: 0 },
      hasMore: false,
    };
  const live = listed.value
    .filter(
      ({ asset }) => asset.status !== "archived" && asset.status !== "draft",
    )
    .map(({ version }) => toMemoryEntry(version))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts = {
    total: live.length,
    profile: live.filter((item) => item.type === "profile").length,
    task: live.filter((item) => item.type === "task").length,
  };
  return {
    entries: live.slice(0, MEMORY_FIRST_SCREEN_LIMIT),
    counts,
    hasMore: live.length > MEMORY_FIRST_SCREEN_LIMIT,
  };
}

/**
 * Create + approve a manual memory entry. The body is hashed by the repository
 * AND persisted as the version's display body (`persistContent`) so the hub
 * card and export show the full memory; provenance keeps a short source
 * excerpt (validated by the repository's privacy filter).
 */
export async function createMemoryEntry(
  input: MemoryCreateInput,
  scope: KnowledgeScope,
): Promise<MemoryActionResponse> {
  try {
    const now = new Date().toISOString();
    const draft = await scope.knowledge.createDraft({
      kind: "memory",
      title: input.title,
      content: input.body,
      persistContent: true,
      provenance: provenanceFor(input, now),
      createdBy: "user",
      actor: "user",
    });
    if (!draft.ok)
      return { ok: false, errorCode: toMemoryError(draft.error.code) };
    const approved = await scope.knowledge.approve(draft.value.assetId, "user");
    if (!approved.ok)
      return { ok: false, errorCode: toMemoryError(approved.error.code) };
    return { ok: true, entry: toMemoryEntry(approved.value) };
  } catch {
    // createDraft throws on unsafe provenance/title input (paths, commands,
    // credentials). Surface as a stable, translatable error.
    return { ok: false, errorCode: "errors.memory.invalidInput" };
  }
}

/**
 * Update an existing memory entry: creates the next version with the edited
 * title/summary/source/project and re-hashes the (edited) body. The type and
 * provenance metadata are re-stamped as manual.
 */
export async function updateMemoryEntry(
  input: MemoryUpdateInput,
  scope: KnowledgeScope,
): Promise<MemoryActionResponse> {
  const current = await scope.knowledge.get(input.assetId);
  if (!current.ok || current.value.kind !== "memory")
    return { ok: false, errorCode: "errors.memory.notFound" };
  try {
    const now = new Date().toISOString();
    const draft = await scope.knowledge.createDraft({
      assetId: input.assetId,
      kind: "memory",
      title: input.title,
      content: input.body,
      persistContent: true,
      provenance: provenanceFor(input, now),
      createdBy: "user",
      actor: "user",
    });
    if (!draft.ok)
      return { ok: false, errorCode: toMemoryError(draft.error.code) };
    const approved = await scope.knowledge.approve(input.assetId, "user");
    if (!approved.ok)
      return { ok: false, errorCode: toMemoryError(approved.error.code) };
    return { ok: true, entry: toMemoryEntry(approved.value) };
  } catch {
    return { ok: false, errorCode: "errors.memory.invalidInput" };
  }
}

/** Archive a memory entry (soft delete; the asset remains in the store). */
export async function archiveMemoryEntry(
  assetId: string,
  scope: KnowledgeScope,
): Promise<{ ok: boolean; errorCode?: string }> {
  const result = await scope.knowledge.archive(assetId, "user");
  if (!result.ok)
    return { ok: false, errorCode: toMemoryError(result.error.code) };
  return { ok: true };
}

/** Fetch the composition root and list all memory entries (route/UI entry). */
export async function listMemoryAssets(): Promise<
  MemoryListResult & { hasMore: boolean }
> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return listMemoryAssetsFrom(await getCompositionRoot());
}

/** Fetch the composition root and create a manual memory entry. */
export async function createMemoryAsset(
  input: MemoryCreateInput,
): Promise<MemoryActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return createMemoryEntry(input, await getCompositionRoot());
}

/** Fetch the composition root and update an existing memory entry. */
export async function updateMemoryAsset(
  input: MemoryUpdateInput,
): Promise<MemoryActionResponse> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return updateMemoryEntry(input, await getCompositionRoot());
}

/** Fetch the composition root and archive a memory entry. */
export async function archiveMemoryAsset(
  assetId: string,
): Promise<{ ok: boolean; errorCode?: string }> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return archiveMemoryEntry(assetId, await getCompositionRoot());
}
