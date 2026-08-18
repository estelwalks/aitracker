import type {
  DesktopApi,
  SecurityScanHistoryEntry,
  SecurityScanReportDto,
  SecurityScanStartRequest,
  SecurityScanState,
} from "../../../../electron/contracts";
import type {
  SecurityHistoryView,
  SecurityReportView,
  SecurityRuntimeCapabilityView,
  SecurityScanScheduleView,
  SecurityScanStateView,
  SecuritySkillView,
} from "../presentation/security-view";

export interface SecurityClient {
  readonly transport: "desktop" | "companion";
  readonly supportsDirectorySelection: boolean;
  listSkills(): Promise<readonly SecuritySkillView[]>;
  selectSkillDirectory(): Promise<SecuritySkillView | null>;
  startScan(request: SecurityScanStartRequest): Promise<SecurityScanStateView>;
  getStatus(): Promise<SecurityScanStateView>;
  getHistory(): Promise<readonly SecurityHistoryView[]>;
  cancelScan(): Promise<boolean>;
  getScanSchedule(): Promise<SecurityScanScheduleView>;
  setScanSchedule(
    schedule: SecurityScanScheduleView,
  ): Promise<SecurityScanScheduleView>;
  getRuntimeCapability(): Promise<SecurityRuntimeCapabilityView>;
}

export type DesktopSecurityClient = SecurityClient;

function desktopApi(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { desktopApi?: DesktopApi }).desktopApi ?? null;
}

export function reportView(report: SecurityScanReportDto): SecurityReportView {
  return {
    status: report.status,
    mode: report.mode,
    verdict: report.verdict,
    riskScore: report.riskScore,
    rulesVersion: report.rulesVersion,
    engineVersion: report.engineVersion,
    locale: report.locale,
    contentHash: report.contentHash,
    scannedFiles: report.scannedFiles,
    threatLevel: report.threatLevel,
    threatLevelDisplay: report.threatLevelDisplay,
    summary: report.summary,
    findings: report.findings,
    branches: report.branches,
    skippedFiles: report.skippedFiles,
  };
}

export function stateView(state: SecurityScanState): SecurityScanStateView {
  return {
    scanId: state.scanId,
    status: state.status,
    mode: state.mode,
    trigger: state.trigger,
    locale: state.locale,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    progress: state.progress,
    currentSkill: state.currentSkill?.name,
    resultIds: state.resultIds,
  };
}

export function historyView(
  entry: SecurityScanHistoryEntry,
): SecurityHistoryView {
  return {
    id: entry.id,
    scanId: entry.scanId,
    skillRef: entry.skillRef,
    skillName: entry.skillName,
    mode: entry.mode,
    trigger: entry.trigger,
    locale: entry.locale,
    status: entry.status,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    report: entry.report ? reportView(entry.report) : undefined,
    errorCode: entry.errorCode,
  };
}

export function getDesktopSecurityClient(): SecurityClient | null {
  const api = desktopApi();
  if (api == null) return null;
  return {
    transport: "desktop",
    supportsDirectorySelection: true,
    async listSkills() {
      return (await api.listSecuritySkills()).map((skill) => ({ ...skill }));
    },
    async selectSkillDirectory() {
      const skill = await api.selectSecuritySkillDirectory();
      return skill ? { ...skill } : null;
    },
    async startScan(request) {
      return stateView(await api.startSecurityScan(request));
    },
    async getStatus() {
      return stateView(await api.getSecurityScanStatus());
    },
    async getHistory() {
      return (await api.getSecurityScanHistory()).map(historyView);
    },
    async cancelScan() {
      return (await api.cancelSecurityScan()).cancelled;
    },
    async getScanSchedule() {
      return { ...(await api.getSecurityScanSchedule()) };
    },
    async setScanSchedule(schedule) {
      return { ...(await api.setSecurityScanSchedule(schedule)) };
    },
    async getRuntimeCapability() {
      return { ...(await api.getSecurityRuntimeCapability()) };
    },
  };
}
