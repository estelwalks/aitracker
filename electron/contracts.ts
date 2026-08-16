export const desktopIpc = {
  getRuntimeInfo: "desktop:get-runtime-info",
  getAutoLaunch: "desktop:get-auto-launch",
  setAutoLaunch: "desktop:set-auto-launch",
  showWindow: "desktop:show-window",
  getPreferences: "desktop:get-preferences",
  setPreference: "desktop:set-preference",
  resetPreferences: "desktop:reset-preferences",
  getLocale: "desktop:get-locale",
  setLocale: "desktop:set-locale",
  localeChanged: "desktop:locale-changed",
  getLocalePreferences: "desktop:get-locale-preferences",
  setLocaleMode: "desktop:set-locale-mode",
  setCurrencyMode: "desktop:set-currency-mode",
  preferencesChanged: "desktop:preferences-changed",
  listSecuritySkills: "security:list-skills",
  selectSecuritySkillDirectory: "security:select-skill-directory",
  startSecurityScan: "security:start-scan",
  getSecurityScanStatus: "security:get-scan-status",
  getSecurityScanHistory: "security:get-scan-history",
  cancelSecurityScan: "security:cancel-scan",
  getSecurityModelConfig: "security:get-model-config",
  setSecurityModelConfig: "security:set-model-config",
  getSecurityScanSchedule: "security:get-scan-schedule",
  setSecurityScanSchedule: "security:set-scan-schedule",
  getSecurityRuntimeCapability: "security:get-runtime-capability",
} as const;

/**
 * The four locales supported by the desktop shell. MUST stay in sync with
 * `src/lib/i18n/locale.ts` — `scripts/check-locale-sync.mjs` guards this,
 * because the Electron tsconfig boundary prevents a safe cross-import.
 */
export type DesktopLocale = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";

/**
 * Display currencies (docs/plan v1.2). MUST stay in sync with
 * `src/lib/i18n/locale.ts` (CURRENCIES) — guarded by check-locale-sync.mjs.
 */
export type DesktopCurrency = "CNY" | "USD" | "JPY" | "KRW";

/** Each preference follows the system or is pinned manually (v1.2). */
export type DesktopPreferenceMode = "system" | "manual";

/** Where a resolved value came from — surfaced in the settings page. */
export type DesktopPreferenceSource = "system" | "manual" | "fallback";

/** Full resolved display preferences (single source of truth in main). */
export interface LocalePreferences {
  locale: DesktopLocale;
  localeSource: DesktopPreferenceSource;
  displayCurrency: DesktopCurrency;
  currencySource: DesktopPreferenceSource;
}

export interface RuntimeInfo {
  platform: NodeJS.Platform;
  version: string;
  packaged: boolean;
}

export interface AutoLaunchState {
  enabled: boolean;
  supported: boolean;
}

export type SecurityScanMode = "quick" | "full";
export type SecurityScanTrigger = "manual" | "automatic";
export type SecurityScanLifecycle =
  | "idle"
  | "running"
  | "cancelling"
  | "complete"
  | "partial"
  | "failed"
  | "cancelled"
  | "model-required";
export type SecurityScanItemStatus =
  "complete" | "partial" | "failed" | "skipped" | "cancelled";
export type SecurityRiskKind =
  | "remote_execution"
  | "command_injection"
  | "data_exfiltration"
  | "secret_access"
  | "persistence"
  | "destructive"
  | "obfuscation"
  | "privilege_escalation"
  | "sensitive_file_access"
  | "network_abuse"
  | "prompt_injection";
export type SecuritySeverity = "critical" | "high" | "medium" | "low";

/** Renderer-safe handle for a main-process-authorized Skill directory. */
export interface SecuritySkillTarget {
  skillRef: `skill:${string}`;
  name: string;
  agents: string[];
  modifiedAt: string;
  source: "discovered" | "selected";
}

export interface SecurityScanStartRequest {
  scope: "single" | "all";
  /** Opaque ref returned by list/select. Absolute paths are never accepted. */
  skillRef?: SecuritySkillTarget["skillRef"];
  mode: SecurityScanMode;
  trigger?: SecurityScanTrigger;
}

export interface SecurityScanProgress {
  discovered: number;
  queued: number;
  started: number;
  completed: number;
  failed: number;
  skipped: number;
  percent: number;
}

export interface SecurityScanState {
  scanId: `scan:${string}` | null;
  status: SecurityScanLifecycle;
  mode: SecurityScanMode | null;
  trigger: SecurityScanTrigger | null;
  locale: DesktopLocale | null;
  startedAt?: string;
  finishedAt?: string;
  currentSkill?: Pick<SecuritySkillTarget, "skillRef" | "name">;
  progress: SecurityScanProgress;
  resultIds: string[];
  errorCode?: string;
}

export const SECURITY_SCAN_CYCLES = ["hourly", "daily", "weekly"] as const;
export type SecurityScanCycle = (typeof SECURITY_SCAN_CYCLES)[number];

export const SECURITY_SCAN_SCOPES = ["all", "agent", "dir"] as const;
export type SecurityScanScope = (typeof SECURITY_SCAN_SCOPES)[number];

/** Persisted automatic-scan cadence; drives the main-process timer. */
export interface SecurityScanSchedule {
  readonly enabled: boolean;
  readonly cycle: SecurityScanCycle; // hourly | daily | weekly
  /** "HH:MM" (24h) local wall-clock time; ignored for hourly. */
  readonly time: string;
  /** "all" scans every managed Skill root; "agent"/"dir" narrow by selection. */
  readonly scope: SecurityScanScope;
  /** Skill-agent names to include when scope === "agent" (empty ⇒ no targets). */
  readonly agents: readonly string[];
  /** Absolute skill root directory prefix when scope === "dir" (null ⇒ no targets). */
  readonly dir: string | null;
  /** Fire an alert notification when a scheduled scan finds risks. */
  readonly notify: boolean;
}

export interface SecurityModelConfigInput {
  provider: "openai" | "anthropic";
  endpoint: string;
  /** Omit to retain the encrypted key; null explicitly clears it. */
  apiKey?: string | null;
  liteModel: string;
  proModel: string;
  timeoutMs?: number;
  contextWindowTokens?: number;
  maxAgentTurns?: number;
}

/** API key material never crosses from main to renderer. */
export interface SecurityModelConfigView {
  configured: boolean;
  provider: "openai" | "anthropic";
  endpoint: string;
  liteModel: string;
  proModel: string;
  timeoutMs: number;
  contextWindowTokens?: number;
  maxAgentTurns: number;
  apiKeyConfigured: boolean;
  encryptionAvailable: boolean;
}

export interface SecurityFindingDto {
  id: string;
  kind: SecurityRiskKind;
  severity: SecuritySeverity;
  source: "static" | "model";
  kindDisplay: string;
  severityDisplay: string;
  ruleId?: string;
  ruleName: string;
  message: string;
  remediation: string;
  weight: number;
  cweId?: string;
  bypassVerification?: boolean;
  path: string;
  line?: number;
  excerpt?: string;
  fileHash?: string;
  reasoning?: string;
}

export interface SecurityScanReportDto {
  status: "complete" | "partial";
  mode: SecurityScanMode;
  verdict: "allow" | "warn" | "block" | "unknown";
  riskScore: number;
  rulesVersion: string;
  engineVersion: string;
  locale: DesktopLocale;
  contentHash: string;
  scannedFiles: number;
  threatLevel: "critical" | "high" | "medium" | "low" | "none";
  threatLevelDisplay: string;
  categories: Partial<
    Record<
      SecurityRiskKind,
      {
        count: number;
        highestSeverity: SecuritySeverity;
        totalWeight: number;
        display: string;
      }
    >
  >;
  summary: string;
  findings: SecurityFindingDto[];
  rules: Array<{
    ruleId: string;
    ruleName: string;
    kind: SecurityRiskKind;
    severity: SecuritySeverity;
    weight: number;
    cweId?: string;
    count: number;
    matches: Array<{
      path: string;
      line?: number;
      excerpt?: string;
      fileHash?: string;
    }>;
  }>;
  branches: Array<{
    name: "static" | "ruleReview" | "singleFileAnalysis" | "multiFileAnalysis";
    status: "complete" | "skipped" | "failed";
    detail?: string;
  }>;
  skippedFiles: Array<{
    path: string;
    reasonCode:
      | "unavailable"
      | "symlink"
      | "depth-limit"
      | "file-limit"
      | "skill-size-limit"
      | "file-size-limit"
      | "binary"
      | "scanner-skip";
    /** Sanitized bounded fallback only; UI should localize reasonCode. */
    reason: string;
  }>;
}

export interface SecurityScanHistoryEntry {
  id: string;
  scanId: `scan:${string}`;
  skillRef: SecuritySkillTarget["skillRef"];
  skillName: string;
  mode: SecurityScanMode;
  trigger: SecurityScanTrigger;
  locale: DesktopLocale;
  status: SecurityScanItemStatus;
  startedAt: string;
  finishedAt: string;
  report?: SecurityScanReportDto;
  errorCode?: string;
}

export interface SecurityRuntimeCapability {
  capability: "detection-only";
  activeDefense: false;
  /** A production automatic quick-scan scheduler is available (not active defense). */
  monitorAvailable: true;
  evidence: "local-static-and-model-analysis";
  cancellation: "between-skills";
  riskKinds: SecurityRiskKind[];
}

export interface DesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getAutoLaunch(): Promise<AutoLaunchState>;
  setAutoLaunch(enabled: boolean): Promise<AutoLaunchState>;
  showWindow(): Promise<void>;
  getPreferences(): Promise<Record<string, unknown>>;
  setPreference(key: string, value: unknown): Promise<void>;
  resetPreferences(): Promise<{ removedKeys: number }>;
  /** Resolve the current display locale (user preference > system > zh-CN). */
  getLocale(): Promise<DesktopLocale>;
  /**
   * Persist a locale choice to the prefs file and rebuild the native tray/
   * menus. Rejects non-locale values; the renderer must only send one of the
   * four `DesktopLocale` strings.
   */
  setLocale(locale: DesktopLocale): Promise<void>;
  /** Subscribe to locale changes initiated in the main process; returns an unsubscribe function. */
  onLocaleChanged(callback: (locale: DesktopLocale) => void): () => void;
  /** Resolve locale + display currency (manual preference > system > fallback). */
  getLocalePreferences(): Promise<LocalePreferences>;
  /**
   * Set the language preference: "system" follows the OS; "manual" pins a
   * locale (required in manual mode). Persisted to prefs; tray/menus rebuild.
   */
  setLocaleMode(
    mode: DesktopPreferenceMode,
    locale?: DesktopLocale,
  ): Promise<void>;
  /**
   * Set the display-currency preference, independent of the language:
   * "system" maps the OS locale's region; "manual" pins a currency (required
   * in manual mode).
   */
  setCurrencyMode(
    mode: DesktopPreferenceMode,
    currency?: DesktopCurrency,
  ): Promise<void>;
  /** Subscribe to preference changes; returns an unsubscribe function. */
  onPreferencesChanged(
    callback: (prefs: LocalePreferences) => void,
  ): () => void;
  listSecuritySkills(): Promise<SecuritySkillTarget[]>;
  selectSecuritySkillDirectory(): Promise<SecuritySkillTarget | null>;
  startSecurityScan(
    request: SecurityScanStartRequest,
  ): Promise<SecurityScanState>;
  getSecurityScanStatus(): Promise<SecurityScanState>;
  getSecurityScanHistory(): Promise<SecurityScanHistoryEntry[]>;
  cancelSecurityScan(): Promise<{ cancelled: boolean }>;
  getSecurityModelConfig(): Promise<SecurityModelConfigView>;
  setSecurityModelConfig(
    config: SecurityModelConfigInput,
  ): Promise<SecurityModelConfigView>;
  getSecurityScanSchedule(): Promise<SecurityScanSchedule>;
  setSecurityScanSchedule(
    schedule: SecurityScanSchedule,
  ): Promise<SecurityScanSchedule>;
  getSecurityRuntimeCapability(): Promise<SecurityRuntimeCapability>;
}
