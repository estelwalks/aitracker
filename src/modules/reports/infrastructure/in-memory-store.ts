import type { ReportDocument, ReportRun, ReportStore } from "../contracts.ts";

/** Test adapter and an embeddable local adapter; a durable server adapter can wrap AtomicJsonStore. */
export function createInMemoryReportStore(): ReportStore & {
  readonly runs: readonly ReportRun[];
  readonly documents: readonly ReportDocument[];
} {
  const runs: ReportRun[] = [];
  const documents: ReportDocument[] = [];
  return {
    get runs() {
      return [...runs];
    },
    get documents() {
      return [...documents];
    },
    async createRun(run) {
      runs.push(structuredClone(run));
    },
    async updateRun(run) {
      const index = runs.findIndex((item) => item.runId === run.runId);
      if (index >= 0) runs[index] = structuredClone(run);
    },
    async saveDocument(document) {
      const index = documents.findIndex(
        (item) => item.reportId === document.reportId,
      );
      if (index >= 0) documents[index] = structuredClone(document);
      else documents.push(structuredClone(document));
    },
    async getDocument(reportId) {
      const document = documents.find((item) => item.reportId === reportId);
      return document ? structuredClone(document) : undefined;
    },
    async latest(definitionId) {
      const rows = documents.filter(
        (item) => item.definitionId === definitionId,
      );
      const document = rows.sort((a, b) =>
        b.generatedAt.localeCompare(a.generatedAt),
      )[0];
      return document ? structuredClone(document) : undefined;
    },
  };
}
