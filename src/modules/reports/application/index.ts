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
  ReportRun,
  ReportStore,
  ReportsApplication,
  ReportSummary,
  ReportContextPort,
  ReportGenerationPort,
} from "../contracts.ts";

export interface ReportsApplicationOptions {
  readonly store: ReportStore;
  readonly context: ReportContextPort;
  readonly generation: ReportGenerationPort;
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
    return ok({
      reportId: document.reportId,
      definitionId: document.definitionId,
      kind: definition.kind,
      title: document.title,
      // `body` was redacted by `safeReportText` at write time; it is generated
      // report content, never raw sessions/paths/secrets.
      body: document.body,
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
      body: "Draft awaiting report generation.",
      generatedAt: startedAt,
      templateVersion: definition.template.version,
      evidence: [],
      assets: [],
    };
    await options.store.saveDocument(document);
    return ok(toReportSummary(document, definition));
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
      context = await options.context.collect({ definition });
    } catch {
      await options.store.updateRun({
        ...run,
        status: "failed",
        finishedAt: now().toISOString(),
        errorCode: "errors.reports.contextFailed",
        retryable: true,
        evidence: [],
      });
      const previous = await options.store.latest(definition.definitionId);
      return previous
        ? ok(toReportSummary(previous, definition))
        : err("errors.reports.contextFailed");
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
      const previous = await options.store.latest(definition.definitionId);
      return previous
        ? ok(toReportSummary(previous, definition))
        : err(result.errorCode ?? "errors.reports.generationFailed");
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
    const document: ReportDocument = {
      reportId: createId("report"),
      runId: run.runId,
      definitionId: definition.definitionId,
      status: "draft",
      title: definition.title,
      body,
      generatedAt: finishedAt,
      templateVersion: definition.template.version,
      evidence: context.evidence,
      assets: context.assets ?? [],
    };
    await options.store.saveDocument(document);
    return ok(toReportSummary(document, definition));
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
    approve: (id, actor) => transition(id, actor, "approved"),
    archive: (id, actor) => transition(id, actor, "archived"),
    list,
    listRuns,
    count,
    countByKind,
  };
}
