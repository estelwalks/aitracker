import type { TaskApi } from "../tasks/api.server.ts";
import {
  scanSecurityFiles,
  type SecurityInputFile,
  type SecurityReport,
} from "../../lib/security/scanner.ts";
import {
  assessmentHistorySummary,
  parseScanRequest,
} from "./application/index.ts";
import { assessmentFromSecurityReport } from "./adapters/scanner.ts";
import type {
  AssetAssessment,
  AssetRef,
  AssessmentHistorySummary,
  ScanJobRef,
  ScanJobRequest,
  ScanJobResult,
  ScanRequest,
  SecurityAssessmentModuleContract,
} from "./contracts.ts";

export type SecurityAssessmentApiResponse = SecurityAssessmentModuleContract;

export interface SecuritySelectionResolver {
  /** Resolves an opaque, server-issued handle. It must never resolve browser paths. */
  resolve(
    selectionRef: ScanRequest["selectionRef"],
  ): Promise<readonly SecurityInputFile[]>;
}

export interface SecurityAssessmentHistoryStore {
  latest(assetRef: AssetRef): Promise<AssetAssessment | undefined>;
  save(assessment: AssetAssessment): Promise<void>;
  list(): Promise<readonly AssetAssessment[]>;
}

export interface SecurityAssessmentServerApi {
  scan(request: unknown): Promise<ScanJobResult>;
  history(): Promise<readonly AssessmentHistorySummary[]>;
}

export interface CreateSecurityAssessmentServerApiOptions {
  readonly tasks: Pick<TaskApi, "runNow">;
  readonly selection: SecuritySelectionResolver;
  readonly history: SecurityAssessmentHistoryStore;
  readonly scanTaskId?: string;
  readonly scanner?: (files: readonly SecurityInputFile[]) => SecurityReport;
  readonly now?: () => Date;
}

function jobRefFor(assetRef: AssetRef, now: Date): ScanJobRef {
  const suffix = `${assetRef.slice("asset:".length)}-${now.getTime()}`
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .slice(0, 120);
  return `scan-job:${suffix}`;
}

function failed(
  job: ScanJobRequest,
  errorCode: `errors.${string}`,
): ScanJobResult {
  return {
    jobRef: job.jobRef,
    status: "failed",
    errorCode,
    finishedAt: new Date().toISOString(),
  };
}

/** Server-only orchestration. Source files are consumed locally and never enter the result DTO. */
export function createSecurityAssessmentServerApi(
  options: CreateSecurityAssessmentServerApiOptions,
): SecurityAssessmentServerApi {
  const scanner = options.scanner ?? ((files) => scanSecurityFiles([...files]));
  const now = options.now ?? (() => new Date());
  const taskId = options.scanTaskId ?? "security.assessment.scan";

  return {
    async scan(input) {
      const parsed = parseScanRequest(input);
      if (!parsed.ok)
        return {
          jobRef: "scan-job:invalid",
          status: "failed",
          errorCode: parsed.error.code,
          finishedAt: now().toISOString(),
        };
      const request = parsed.value;
      const requestedAt = now().toISOString();
      const job: ScanJobRequest = {
        jobRef: jobRefFor(request.assetRef, new Date(requestedAt)),
        taskId,
        assetRef: request.assetRef,
        assetKind: request.assetKind,
        selectionRef: request.selectionRef,
        requestedAt,
      };
      const queued = await options.tasks.runNow({ taskId });
      if (!queued.ok) return failed(job, queued.error.code);
      try {
        const files = await options.selection.resolve(request.selectionRef);
        const report = scanner(files);
        const assessment = assessmentFromSecurityReport({
          assetRef: request.assetRef,
          assetKind: request.assetKind,
          report,
        });
        await options.history.save(assessment);
        return {
          jobRef: job.jobRef,
          status: "succeeded",
          assessment,
          finishedAt: now().toISOString(),
        };
      } catch {
        // A failed scan must not overwrite or delete the previous assessment.
        return failed(job, "errors.security.scanFailed");
      }
    },
    async history() {
      const values = await options.history.list();
      return values.map(assessmentHistorySummary);
    },
  };
}
