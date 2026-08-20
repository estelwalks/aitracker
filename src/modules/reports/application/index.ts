import { err, ok, type Result } from "../../../shared/result.ts";
import {
  BUILTIN_REPORT_DEFINITIONS,
  canTransition,
  safeReportText,
  toDefinitionSummary,
  toReportSummary,
} from "../domain.ts";
import type {
  GenerateReportInput,
  ReportContent,
  ReportCountsByKind,
  ReportDefinition,
  ReportDocument,
  ReportPeriod,
  ReportRun,
  ReportStore,
  ReportsApplication,
  ReportSummary,
  ReportContextPort,
  ReportContentStore,
  ReportGenerationPort,
} from "../contracts.ts";
import { periodStartDate } from "../period.ts";

export interface ReportsApplicationOptions {
  readonly store: ReportStore;
  readonly context: ReportContextPort;
  readonly generation: ReportGenerationPort;
  readonly content?: ReportContentStore;
  /** Persist report bodies inline through `store` (used by SQLite). */
  readonly inlineContent?: boolean;
  readonly definitions?: readonly ReportDefinition[];
  readonly now?: () => Date;
  readonly createId?: (prefix: string) => string;
}

const defaultId = (prefix: string): string =>
  `${prefix}:${crypto.randomUUID()}`;

function safeActor(actor: string): string {
  const value = actor.trim();
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(value))
    throw new TypeError("actor is invalid");
  return value;
}

/**
 * Local-time anchor inside the target period (midday of the period's start
 * day). Using it as `generatedAt` makes the persisted report archive to the
 * selected day/week/month instead of "now". Null when the key is malformed.
 */
function periodAnchorDate(period: ReportPeriod): Date | null {
  const start = periodStartDate(period.granularity, period.key);
  if (!start) return null;
  start.setHours(12, 0, 0, 0);
  return start;
}

function definitionOf(
  definitions: readonly ReportDefinition[],
  id: string,
): ReportDefinition | undefined {
  return definitions.find(
    (definition) => definition.definitionId === id && definition.enabled,
  );
}

export function createReportsApplication(
  options: ReportsApplicationOptions,
): ReportsApplication {
  const definitions = options.definitions ?? BUILTIN_REPORT_DEFINITIONS;
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? defaultId;
  const memoryContent = new Map<string, string>();
  const fallbackContent: ReportContentStore = {
    async create(document, body) {
      const file = `${document.reportId.replace(/[^A-Za-z0-9_-]/g, "-")}.md`;
      memoryContent.set(file, body);
      return file;
    },
    async read(file) {
      const body = memoryContent.get(file);
      if (body === undefined) throw new Error("report content not found");
      return body;
    },
    async replace(document, body) {
      const file = `${document.reportId.replace(/[^A-Za-z0-9_-]/g, "-")}-${crypto.randomUUID()}.md`;
      memoryContent.set(file, body);
      return file;
    },
  };
  const content: ReportContentStore | undefined = options.inlineContent
    ? undefined
    : (options.content ?? fallbackContent);

  const bodyFor = async (document: ReportDocument): Promise<string> => {
    if (document.contentFile)
      return (content ?? fallbackContent).read(document.contentFile);
    if (document.body === undefined) throw new Error("report content missing");
    // Legacy inline-document compatibility: the first successful read creates
    // the Markdown file, then updates metadata without the inline body.
    if (!content) return document.body;
    const contentFile = await content.create(document, document.body);
    const { body: _legacyBody, ...metadata } = document;
    await options.store.saveDocument({ ...metadata, contentFile });
    return document.body;
  };

  const get = async (reportId: string): Promise<Result<ReportSummary>> => {
    const document = await options.store.getDocument(reportId);
    if (!document) return err("errors.reports.notFound");
    const definition = definitions.find(
      (item) => item.definitionId === document.definitionId,
    );
    return definition
      ? ok(toReportSummary(document, definition))
      : err("errors.reports.notFound");
  };

  const readContent = async (
    reportId: string,
  ): Promise<Result<ReportContent>> => {
    const document = await options.store.getDocument(reportId);
    if (!document) return err("errors.reports.notFound");
    const definition = definitions.find(
      (item) => item.definitionId === document.definitionId,
    );
    if (!definition) return err("errors.reports.notFound");
    let body: string;
    try {
      body = await bodyFor(document);
    } catch {
      return err("errors.reports.contentReadFailed");
    }
    return ok({
      reportId: document.reportId,
      definitionId: document.definitionId,
      kind: definition.kind,
      title: document.title,
      body,
      generatedAt: document.generatedAt,
    });
  };

  const createDraft = async (input: {
    definitionId: string;
    actor: string;
    trigger?: "manual" | "schedule";
  }): Promise<Result<ReportSummary>> => {
    const definition = definitionOf(definitions, input.definitionId);
    if (!definition) return err("errors.reports.definitionNotFound");
    safeActor(input.actor);
    const startedAt = now().toISOString();
    const run: ReportRun = {
      runId: createId("report-run"),
      definitionId: definition.definitionId,
      trigger: input.trigger ?? "manual",
      status: "queued",
      startedAt,
      evidence: [],
    };
    await options.store.createRun(run);
    const document: ReportDocument = {
      reportId: createId("report"),
      runId: run.runId,
      definitionId: definition.definitionId,
      status: "draft",
      title: definition.title,
      generatedAt: startedAt,
      templateVersion: definition.template.version,
      evidence: [],
      assets: [],
    };
    const draftBody = "Draft awaiting report generation.";
    const persisted = content
      ? { ...document, contentFile: await content.create(document, draftBody) }
      : { ...document, body: draftBody };
    await options.store.saveDocument(persisted);
    return ok(toReportSummary(persisted, definition));
  };

  const generate = async (
    input: GenerateReportInput,
  ): Promise<Result<ReportSummary>> => {
    const definition = definitionOf(definitions, input.definitionId);
    if (!definition) return err("errors.reports.definitionNotFound");
    const run: ReportRun = {
      runId: createId("report-run"),
      definitionId: definition.definitionId,
      trigger: input.trigger,
      status: "running",
      startedAt: now().toISOString(),
      evidence: [],
    };
    await options.store.createRun(run);
    let context;
    try {
      context = await options.context.collect({
        definition,
        period: input.period,
      });
    } catch {
      await options.store.updateRun({
        ...run,
        status: "failed",
        finishedAt: now().toISOString(),
        errorCode: "errors.reports.contextFailed",
        retryable: true,
        evidence: [],
      });
      return err("errors.reports.contextFailed");
    }
    const result = await options.generation.generate({
      definition,
      context,
      budgetUsd: input.budgetUsd,
      modelId: input.modelId,
    });
    const finishedAt = now().toISOString();
    const finalRun: ReportRun = {
      ...run,
      status: result.status,
      finishedAt,
      errorCode: result.errorCode,
      retryable: result.retryable,
      evidence: context.evidence,
    };
    await options.store.updateRun(finalRun);
    if (result.status === "failed" || result.status === "budget-exceeded") {
      return err(result.errorCode ?? "errors.reports.generationFailed");
    }
    let body: string;
    try {
      body = safeReportText(
        result.body ??
          "Offline report fallback: no model response was available.",
      );
    } catch {
      body =
        "Offline report fallback: generated content was withheld by the privacy policy.";
    }
    const generatedAt = input.period
      ? (periodAnchorDate(input.period) ?? new Date(finishedAt)).toISOString()
      : finishedAt;
    const document: ReportDocument = {
      reportId: createId("report"),
      runId: run.runId,
      definitionId: definition.definitionId,
      status: "draft",
      title: definition.title,
      generatedAt,
      templateVersion: definition.template.version,
      evidence: context.evidence,
      assets: context.assets ?? [],
    };
    const persisted = content
      ? { ...document, contentFile: await content.create(document, body) }
      : { ...document, body };
    await options.store.saveDocument(persisted);
    return ok(toReportSummary(persisted, definition));
  };

  const saveContent = async (
    reportId: string,
    body: string,
  ): Promise<Result<ReportContent>> => {
    if (
      body.includes("\0") ||
      new TextEncoder().encode(body).byteLength > 2 * 1024 * 1024
    )
      return err("errors.reports.invalidContent");
    const document = await options.store.getDocument(reportId);
    if (!document) return err("errors.reports.notFound");
    const definition = definitions.find(
      (item) => item.definitionId === document.definitionId,
    );
    if (!definition) return err("errors.reports.notFound");
    try {
      if (content) {
        const contentFile = document.contentFile
          ? await content.replace(document, body)
          : await content.create(document, body);
        const { body: _legacyBody, ...metadata } = document;
        // The new Markdown revision is durable before the metadata reference
        // is switched, so readers see either the complete old or new file.
        await options.store.saveDocument({ ...metadata, contentFile });
      } else {
        const { contentFile: _legacyFile, ...metadata } = document;
        await options.store.saveDocument({ ...metadata, body });
      }
      return ok({
        reportId,
        definitionId: document.definitionId,
        kind: definition.kind,
        title: document.title,
        body,
        generatedAt: document.generatedAt,
      });
    } catch {
      return err("errors.reports.contentWriteFailed");
    }
  };

  const transition = async (
    reportId: string,
    actor: string,
    to: "approved" | "archived",
  ): Promise<Result<ReportSummary>> => {
    safeActor(actor);
    const document = await options.store.getDocument(reportId);
    if (!document) return err("errors.reports.notFound");
    if (!canTransition(document.status, to))
      return err("errors.reports.invalidTransition");
    const next: ReportDocument = {
      ...document,
      status: to,
      ...(to === "approved"
        ? { approvedBy: actor, approvedAt: now().toISOString() }
        : {}),
    };
    await options.store.saveDocument(next);
    const definition = definitions.find(
      (item) => item.definitionId === next.definitionId,
    );
    return definition
      ? ok(toReportSummary(next, definition))
      : err("errors.reports.notFound");
  };

  const list = async (): Promise<Result<readonly ReportSummary[]>> => {
    try {
      const documents = await options.store.listDocuments();
      // Opening the reports page should make the whole archive portable, not
      // only reports opened individually. Migrate sequentially because the
      // metadata store uses read-modify-write; concurrent migrations could
      // otherwise overwrite one another. Each row is best-effort so one bad
      // legacy record never blanks the report list.
      for (const document of documents) {
        if (!document.contentFile && document.body !== undefined) {
          try {
            await bodyFor(document);
          } catch {
            // The original metadata remains readable/listable for retry later.
          }
        }
      }
      return ok(
        documents.flatMap((document) => {
          const definition = definitions.find(
            (item) => item.definitionId === document.definitionId,
          );
          return definition ? [toReportSummary(document, definition)] : [];
        }),
      );
    } catch {
      return err("errors.reports.queryFailed");
    }
  };

  const listRuns = async (): Promise<Result<readonly ReportRun[]>> => {
    try {
      return ok(await options.store.listRuns());
    } catch {
      return err("errors.reports.queryFailed");
    }
  };

  const count = async (): Promise<number | null> => {
    try {
      const documents = await options.store.listDocuments();
      return documents.length;
    } catch {
      return null;
    }
  };

  const countByKind = async (): Promise<ReportCountsByKind> => {
    try {
      const documents = await options.store.listDocuments();
      const counts: { daily: number; weekly: number; monthly: number } = {
        daily: 0,
        weekly: 0,
        monthly: 0,
      };
      for (const document of documents) {
        if (document.definitionId === "reports.daily") counts.daily += 1;
        else if (document.definitionId === "reports.weekly") counts.weekly += 1;
        else counts.monthly += 1;
      }
      return counts;
    } catch {
      return { daily: null, weekly: null, monthly: null };
    }
  };

  return {
    definitions: definitions.map(toDefinitionSummary),
    createDraft,
    generate,
    get,
    readContent,
    saveContent,
    approve: (id, actor) => transition(id, actor, "approved"),
    archive: (id, actor) => transition(id, actor, "archived"),
    list,
    listRuns,
    count,
    countByKind,
  };
}
