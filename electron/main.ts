import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  safeStorage,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";

import {
  desktopIpc,
  type AutoLaunchState,
  type RuntimeInfo,
  type SecurityScanCycle,
  type SecurityScanHistoryEntry,
  type SecurityScanSchedule,
  type SecurityScanState,
} from "./contracts.js";
import {
  createTrayTemplate,
  electronMessages,
  interpolate,
  normalizeDesktopCurrency,
  normalizeDesktopLocale,
  resolveDesktopPreferences,
  type DesktopLocale,
  type DesktopPreferenceMode,
  type LocalePreferences,
  type TrayTemplateItem,
} from "./i18n.js";
import {
  startLocalWebServer,
  type LocalWebServer,
} from "./local-web-server.js";
import {
  CURRENCY_MODE_PREF_KEY,
  CURRENCY_PREF_KEY,
  LOCALE_MODE_PREF_KEY,
  LOCALE_PREF_KEY,
  PREFS_FILENAME,
  readPrefs,
  writePrefs,
} from "./prefs.js";
import {
  APP_DATA_DIR,
  APP_NAME,
  ENV,
  STORAGE_KEY_PREFIX,
} from "./app-config.js";
import { SecurityScannerService } from "./security-scanner-service.js";
import { isTrustedIpcSender } from "./ipc-security.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const developmentUrl = process.env[ENV.DEV_URL];
const isDevelopment = Boolean(developmentUrl);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localWebServer: LocalWebServer | null = null;
let allowedOrigin = "";
let isQuitting = false;
let securityScanner: SecurityScannerService | null = null;
let automaticSecurityScanTimer: NodeJS.Timeout | null = null;
/** Resolved at startup: manual preference > system mapping > fallback. */
let currentPreferences: LocalePreferences = {
  locale: "zh-CN",
  localeSource: "fallback",
  displayCurrency: "USD",
  currencySource: "fallback",
};

const CURRENT_SCHEMA_VERSION = "v10";

function prefsPath(): string {
  return join(app.getPath("userData"), PREFS_FILENAME);
}

function hasCloseHintBeenShown(): boolean {
  return readPrefs(prefsPath()).closeHintShown === true;
}

function markCloseHintShown(): void {
  const prefs = readPrefs(prefsPath());
  prefs.closeHintShown = true;
  writePrefs(prefsPath(), prefs);
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const mainFrame = event.sender.mainFrame;
  if (
    !event.senderFrame ||
    !mainFrame ||
    !isTrustedIpcSender({
      senderWebContentsId: event.sender.id,
      expectedWebContentsId:
        mainWindow == null || mainWindow.isDestroyed()
          ? null
          : mainWindow.webContents.id,
      senderFrameRoutingId: event.senderFrame.routingId,
      mainFrameRoutingId: mainFrame.routingId,
      senderFrameUrl: event.senderFrame.url,
      allowedOrigin,
    })
  ) {
    throw new Error("Untrusted IPC sender");
  }
}

function getAutoLaunchState(): AutoLaunchState {
  const supported =
    process.platform === "darwin" || process.platform === "win32";
  return {
    enabled: supported
      ? app.getLoginItemSettings({ path: process.execPath }).openAtLogin
      : false,
    supported,
  };
}

function setAutoLaunch(enabled: boolean): AutoLaunchState {
  const currentState = getAutoLaunchState();
  if (!currentState.supported) {
    return currentState;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: isDevelopment ? [app.getAppPath()] : [],
  });
  return getAutoLaunchState();
}

function showMainWindow(): void {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function openBrowserCompanion(): void {
  if (!localWebServer) return;
  const url = localWebServer.createBrowserBootstrapUrl(
    `/security?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`,
  );
  void shell.openExternal(url);
}

const SECURITY_SCAN_CYCLE_MS: Record<SecurityScanCycle, number> = {
  hourly: 60 * 60 * 1_000,
  daily: 24 * 60 * 60 * 1_000,
  weekly: 7 * 24 * 60 * 60 * 1_000,
};

const DAY_MS = 24 * 60 * 60 * 1_000;
const WEEK_MS = 7 * DAY_MS;
/** Wall-clock time of the most recent scheduled automatic run (weekly anchor). */
let lastAutomaticScanRunAt: number | null = null;

const SECURITY_RISK_NOTICE: Record<
  DesktopLocale,
  { title: string; body: string }
> = {
  "zh-CN": {
    title: "安全扫描发现风险",
    body: "自动扫描在 {count} 个 Skill 中发现风险，请查看安全中心。",
  },
  "en-US": {
    title: "Security scan found risks",
    body: "The automatic scan found risks in {count} skill(s). Open the Security Center.",
  },
  "ja-JP": {
    title: "セキュリティスキャンでリスクを検出",
    body: "自動スキャンで {count} 件のリスクを検出しました。",
  },
  "ko-KR": {
    title: "보안 스캔에서 위험 발견",
    body: "자동 스캔에서 {count}개의 위험이 발견되었습니다.",
  },
};

/** Parse a validated "HH:MM" schedule time into local hour/minute. */
function parseScheduleTime(time: string): [number, number] {
  const [hour, minute] = time.split(":").map(Number);
  return [hour, minute];
}

/** Next local wall-clock occurrence of `time` strictly after `base`. */
function nextTimeAtOrAfter(base: Date, time: string): Date {
  const [hour, minute] = parseScheduleTime(time);
  const next = new Date(base);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Next local occurrence of the anchor weekday's `time` after `base` — the
 * weekly cadence runs once per week on the weekday the schedule was last armed.
 */
function nextWeeklyAtOrAfter(base: Date, anchor: Date, time: string): Date {
  const [hour, minute] = parseScheduleTime(time);
  const next = new Date(anchor);
  next.setHours(hour, minute, 0, 0);
  while (next.getTime() <= base.getTime()) next.setDate(next.getDate() + 7);
  return next;
}

/**
 * Delay until the next automatic run: hourly reuses the fixed 1h interval;
 * daily/weekly honor the configured "HH:MM" local wall-clock time.
 */
function nextAutomaticScanDelayMs(schedule: SecurityScanSchedule): number {
  const now = new Date();
  if (schedule.cycle === "hourly") return SECURITY_SCAN_CYCLE_MS.hourly;
  if (schedule.cycle === "daily") {
    return nextTimeAtOrAfter(now, schedule.time).getTime() - now.getTime();
  }
  const anchor =
    lastAutomaticScanRunAt == null ? now : new Date(lastAutomaticScanRunAt);
  return Math.max(
    0,
    nextWeeklyAtOrAfter(now, anchor, schedule.time).getTime() - now.getTime(),
  );
}

async function runAutomaticSecurityScan(
  schedule?: SecurityScanSchedule,
): Promise<void> {
  const scanner = securityScanner;
  if (!scanner) return;
  const status = scanner.getStatus().status;
  if (status === "running" || status === "cancelling") return;
  let state: SecurityScanState;
  try {
    state = await scanner.startAutomaticScan();
  } catch {
    // No discovered Skills (or a concurrent manual scan) is a recoverable
    // automatic pass. The next run retries through the same safe service.
    return;
  }
  if (schedule?.notify !== true) return;
  await notifyIfAutomaticScanFoundRisks(scanner, state.scanId);
}

/** Wait for the automatic scan to settle, then notify when it found risks. */
async function notifyIfAutomaticScanFoundRisks(
  scanner: SecurityScannerService,
  scanId: string | null,
): Promise<void> {
  const state = await waitForAutomaticScanSettled(scanner, scanId);
  // A manual scan taking over the session is never the automatic run we armed.
  if (scanId == null || state.scanId !== scanId) return;
  if (state.status !== "complete" && state.status !== "partial") return;
  if (state.resultIds.length === 0) return;
  const history = await scanner.history();
  const scanEntries = history.filter(
    (entry: SecurityScanHistoryEntry) => entry.scanId === scanId,
  );
  const riskCount = scanEntries.filter(
    (entry) =>
      (entry.status === "complete" || entry.status === "partial") &&
      (entry.report?.findings.length ?? 0) > 0,
  ).length;
  if (riskCount === 0) return;
  if (!Notification.isSupported()) return;
  const notice = SECURITY_RISK_NOTICE[currentPreferences.locale];
  const notification = new Notification({
    title: notice.title,
    body: interpolate(notice.body, { count: riskCount }),
  });
  notification.on("click", showMainWindow);
  notification.show();
}

async function waitForAutomaticScanSettled(
  scanner: SecurityScannerService,
  scanId: string | null,
): Promise<SecurityScanState> {
  const deadline = Date.now() + 10 * 60 * 1_000;
  while (Date.now() < deadline) {
    const state = scanner.getStatus();
    if (state.scanId !== scanId) return state;
    if (state.status !== "running" && state.status !== "cancelling") {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return scanner.getStatus();
}

function clearAutomaticSecurityScanTimer(): void {
  if (automaticSecurityScanTimer) {
    clearTimeout(automaticSecurityScanTimer);
    automaticSecurityScanTimer = null;
  }
}

/**
 * Schedule the automatic security scan from the persisted schedule: an
 * immediate first pass on launch when enabled, then a time-aware timer for the
 * configured cycle. A disabled schedule clears the timer entirely.
 */
async function scheduleAutomaticSecurityScan(): Promise<void> {
  clearAutomaticSecurityScanTimer();
  const scanner = securityScanner;
  if (!scanner) return;
  let schedule: SecurityScanSchedule;
  try {
    schedule = await scanner.getScanSchedule();
  } catch {
    // Corrupt/missing schedule already falls back to the default inside the
    // service; any unexpected failure simply leaves auto-scan unscheduled.
    return;
  }
  if (!schedule.enabled) return;
  // Initial run shortly after launch when enabled, then arm the repeating timer.
  void runAutomaticSecurityScan(schedule);
  armAutomaticSecurityScanTimer(schedule);
}

function armAutomaticSecurityScanTimer(schedule: SecurityScanSchedule): void {
  const delayMs = nextAutomaticScanDelayMs(schedule);
  automaticSecurityScanTimer = setTimeout(() => {
    automaticSecurityScanTimer = null;
    lastAutomaticScanRunAt = Date.now();
    void runAutomaticSecurityScan(schedule);
    armAutomaticSecurityScanTimer(schedule);
  }, delayMs);
}

function registerIpcHandlers(): void {
  ipcMain.handle(desktopIpc.getRuntimeInfo, (event): RuntimeInfo => {
    assertTrustedSender(event);
    return {
      platform: process.platform,
      version: app.getVersion(),
      packaged: app.isPackaged,
    };
  });
  ipcMain.handle(desktopIpc.getAutoLaunch, (event): AutoLaunchState => {
    assertTrustedSender(event);
    return getAutoLaunchState();
  });
  ipcMain.handle(
    desktopIpc.setAutoLaunch,
    (event, enabled: unknown): AutoLaunchState => {
      assertTrustedSender(event);
      if (typeof enabled !== "boolean") {
        throw new TypeError("Auto-launch value must be a boolean");
      }
      return setAutoLaunch(enabled);
    },
  );
  ipcMain.handle(desktopIpc.showWindow, (event): void => {
    assertTrustedSender(event);
    showMainWindow();
  });

  ipcMain.handle(
    desktopIpc.getPreferences,
    (event): Record<string, unknown> => {
      assertTrustedSender(event);
      return readPrefs(prefsPath());
    },
  );

  ipcMain.handle(
    desktopIpc.setPreference,
    (event, key: unknown, value: unknown): void => {
      assertTrustedSender(event);
      if (typeof key !== "string" || key.length === 0)
        throw new TypeError("Preference key required");
      const current = readPrefs(prefsPath());
      current[key] = value;
      writePrefs(prefsPath(), current);
    },
  );
  ipcMain.handle(
    desktopIpc.resetPreferences,
    async (event): Promise<{ removedKeys: number }> => {
      assertTrustedSender(event);
      const current = readPrefs(prefsPath());
      const keys = Object.keys(current).filter(
        (key) => key === "closeHintShown" || key.startsWith(STORAGE_KEY_PREFIX),
      );
      for (const key of keys) delete current[key];
      writePrefs(prefsPath(), current);
      await securityScanner?.clear();
      return { removedKeys: keys.length };
    },
  );

  ipcMain.handle(desktopIpc.getLocale, (event): DesktopLocale => {
    assertTrustedSender(event);
    return currentPreferences.locale;
  });

  ipcMain.handle(desktopIpc.setLocale, (event, locale: unknown): void => {
    assertTrustedSender(event);
    // Legacy manual shortcut — pins the manual locale mode.
    const next = normalizeDesktopLocale(locale);
    if (next == null) {
      // IPC 不接受任意 locale — only the four supported values.
      throw new TypeError("Unsupported locale");
    }
    const prefs = readPrefs(prefsPath());
    prefs[LOCALE_MODE_PREF_KEY] = "manual";
    prefs[LOCALE_PREF_KEY] = next;
    applyPreferences(prefs);
  });

  ipcMain.handle(
    desktopIpc.getLocalePreferences,
    (event): LocalePreferences => {
      assertTrustedSender(event);
      return currentPreferences;
    },
  );

  ipcMain.handle(
    desktopIpc.setLocaleMode,
    (event, mode: unknown, locale: unknown): void => {
      assertTrustedSender(event);
      if (mode !== "system" && mode !== "manual") {
        throw new TypeError("Unsupported preference mode");
      }
      const prefs = readPrefs(prefsPath());
      prefs[LOCALE_MODE_PREF_KEY] = mode;
      if (mode === "manual") {
        const next = normalizeDesktopLocale(locale);
        if (next == null) throw new TypeError("Unsupported locale");
        prefs[LOCALE_PREF_KEY] = next;
      }
      applyPreferences(prefs);
    },
  );

  ipcMain.handle(
    desktopIpc.setCurrencyMode,
    (event, mode: unknown, currency: unknown): void => {
      assertTrustedSender(event);
      if (mode !== "system" && mode !== "manual") {
        throw new TypeError("Unsupported preference mode");
      }
      const prefs = readPrefs(prefsPath());
      prefs[CURRENCY_MODE_PREF_KEY] = mode;
      if (mode === "manual") {
        const next = normalizeDesktopCurrency(currency);
        if (next == null) throw new TypeError("Unsupported currency");
        prefs[CURRENCY_PREF_KEY] = next;
      }
      applyPreferences(prefs);
    },
  );

  ipcMain.handle(desktopIpc.listSecuritySkills, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.listSkills();
  });
  ipcMain.handle(desktopIpc.selectSecuritySkillDirectory, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({ properties: ["openDirectory"] });
    const selected = result.filePaths[0];
    if (result.canceled || !selected) return null;
    return securityScanner.registerSelectedDirectory(selected);
  });
  ipcMain.handle(
    desktopIpc.startSecurityScan,
    async (event, request: unknown) => {
      assertTrustedSender(event);
      if (!securityScanner) throw new Error("Security scanner is unavailable");
      return securityScanner.start(request);
    },
  );
  ipcMain.handle(desktopIpc.getSecurityScanStatus, (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getStatus();
  });
  ipcMain.handle(desktopIpc.getSecurityScanHistory, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.history();
  });
  ipcMain.handle(desktopIpc.cancelSecurityScan, (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.cancel();
  });
  ipcMain.handle(desktopIpc.getSecurityModelConfig, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getModelConfig();
  });
  ipcMain.handle(
    desktopIpc.setSecurityModelConfig,
    async (event, config: unknown) => {
      assertTrustedSender(event);
      if (!securityScanner) throw new Error("Security scanner is unavailable");
      return securityScanner.setModelConfig(config);
    },
  );
  ipcMain.handle(desktopIpc.getSecurityScanSchedule, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getScanSchedule();
  });
  ipcMain.handle(
    desktopIpc.setSecurityScanSchedule,
    async (event, schedule: unknown) => {
      assertTrustedSender(event);
      if (!securityScanner) throw new Error("Security scanner is unavailable");
      const result = await securityScanner.setScanSchedule(schedule);
      await scheduleAutomaticSecurityScan();
      return result;
    },
  );
  ipcMain.handle(desktopIpc.getSecurityRuntimeCapability, (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getRuntimeCapability();
  });
}

/**
 * Persist preference changes, re-resolve, rebuild the tray when the locale
 * changed and broadcast the new resolution to the renderer.
 */
function applyPreferences(prefs: Record<string, unknown>): void {
  writePrefs(prefsPath(), prefs);
  const resolved = resolveDesktopPreferences(prefs, app.getLocale());
  const localeChanged = resolved.locale !== currentPreferences.locale;
  currentPreferences = resolved;
  if (localeChanged) rebuildTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(desktopIpc.localeChanged, resolved.locale);
    mainWindow.webContents.send(desktopIpc.preferencesChanged, resolved);
  }
}

/**
 * (Re)build the tray icon and its context menu in the current locale.
 * Language switches destroy and recreate the menu so labels and the
 * auto-launch checkbox state stay in sync.
 */
function rebuildTray(): void {
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, "tray-icon.png")
    : join(app.getAppPath(), "build", "tray-icon.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") {
    trayIcon.setTemplateImage(true);
  }

  const autoLaunch = getAutoLaunchState();
  const template: TrayTemplateItem[] = createTrayTemplate(
    currentPreferences.locale,
    {
      autoLaunchEnabled: autoLaunch.enabled,
      autoLaunchSupported: autoLaunch.supported,
      browserCompanionSupported: localWebServer != null,
    },
    {
      onOpen: showMainWindow,
      onOpenBrowser: openBrowserCompanion,
      onToggleAutoLaunch: (checked) => {
        setAutoLaunch(checked);
      },
      onQuit: () => {
        isQuitting = true;
        app.quit();
      },
    },
  );

  if (tray) tray.destroy();
  tray = new Tray(trayIcon);
  tray.setToolTip(electronMessages[currentPreferences.locale].tray.tooltip);
  tray.setContextMenu(
    Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]),
  );
  tray.on("click", showMainWindow);
}

async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.on("close", async (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();

    if (!hasCloseHintBeenShown()) {
      const closeHint =
        electronMessages[currentPreferences.locale].dialog.closeHint;
      await dialog.showMessageBox(mainWindow!, {
        message: closeHint.message,
        buttons: [closeHint.ok],
      });
      markCloseHintShown();
    }

    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const appUrl = localWebServer
    ? localWebServer.createBrowserBootstrapUrl(
        `/?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`,
      )
    : `${allowedOrigin}?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
  await mainWindow.loadURL(appUrl);
}

async function resolveApplicationOrigin(): Promise<string> {
  if (developmentUrl) {
    return new URL(developmentUrl).origin;
  }

  const webRoot = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(app.getAppPath(), ".output");
  localWebServer = await startLocalWebServer(webRoot, {
    securityScanner: securityScanner ?? undefined,
  });
  return localWebServer.origin;
}

async function prewarmLocalData(origin: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    // The first document request runs the route loaders, including the local
    // usage scan. Finish that work before showing the BrowserWindow so a fresh
    // installation opens with its historical usage instead of briefly
    // rendering an empty dashboard. Later loads reuse the scanner's
    // file-signature index and in-memory snapshot.
    const prewarmUrl = localWebServer
      ? localWebServer.createBrowserBootstrapUrl(
          `/?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`,
        )
      : `${origin}/?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
    let response: Response;
    if (localWebServer) {
      // Node fetch follows redirects but does not persist Set-Cookie. Complete
      // the same one-time bootstrap handshake as a browser explicitly so the
      // authenticated prewarm request reaches the route loaders.
      const bootstrap = await fetch(prewarmUrl, {
        headers: { Accept: "text/html" },
        redirect: "manual",
        signal: controller.signal,
      });
      const location = bootstrap.headers.get("location");
      const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0];
      await bootstrap.body?.cancel();
      if (bootstrap.status !== 303 || location == null || cookie == null) {
        throw new Error("Local prewarm bootstrap handshake failed");
      }
      response = await fetch(new URL(location, origin), {
        headers: { Accept: "text/html", Cookie: cookie },
        signal: controller.signal,
      });
    } else {
      response = await fetch(prewarmUrl, {
        headers: { Accept: "text/html" },
        signal: controller.signal,
      });
    }
    if (!response.ok) {
      console.warn(`Initial data scan returned HTTP ${response.status}`);
    }
    await response.body?.cancel();
  } catch (error) {
    // Startup remains recoverable: the BrowserWindow request will retry the
    // same loaders, and visible-page polling continues refreshing afterwards.
    console.warn("Initial data scan did not finish before launch", error);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDataCompatibility(): Promise<{
  compatible: boolean;
  oldVersion?: string;
}> {
  const homeDir = process.env[ENV.USAGE_HOME] || app.getPath("home");
  const schemaVersionPath = join(homeDir, APP_DATA_DIR, "schema_version");

  try {
    const content = await readFile(schemaVersionPath, "utf8");
    const existing = content.trim();
    if (existing === CURRENT_SCHEMA_VERSION) {
      return { compatible: true };
    }
    return { compatible: false, oldVersion: existing };
  } catch {
    // File doesn't exist — write the current version and proceed
    try {
      await writeFile(schemaVersionPath, CURRENT_SCHEMA_VERSION, "utf8");
    } catch {
      // Directory might not exist; start-up will handle this naturally
    }
    return { compatible: true };
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);
  app.on("before-quit", () => {
    isQuitting = true;
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      mainWindow = null;
    }
  });
  app.on("activate", () => {
    if (mainWindow) {
      showMainWindow();
    } else {
      void createMainWindow();
    }
  });
  app.on("will-quit", () => {
    clearAutomaticSecurityScanTimer();
    ipcMain.removeHandler(desktopIpc.getRuntimeInfo);
    ipcMain.removeHandler(desktopIpc.getAutoLaunch);
    ipcMain.removeHandler(desktopIpc.setAutoLaunch);
    ipcMain.removeHandler(desktopIpc.showWindow);
    ipcMain.removeHandler(desktopIpc.getPreferences);
    ipcMain.removeHandler(desktopIpc.setPreference);
    ipcMain.removeHandler(desktopIpc.resetPreferences);
    ipcMain.removeHandler(desktopIpc.getLocale);
    ipcMain.removeHandler(desktopIpc.setLocale);
    ipcMain.removeHandler(desktopIpc.getLocalePreferences);
    ipcMain.removeHandler(desktopIpc.setLocaleMode);
    ipcMain.removeHandler(desktopIpc.setCurrencyMode);
    ipcMain.removeHandler(desktopIpc.listSecuritySkills);
    ipcMain.removeHandler(desktopIpc.selectSecuritySkillDirectory);
    ipcMain.removeHandler(desktopIpc.startSecurityScan);
    ipcMain.removeHandler(desktopIpc.getSecurityScanStatus);
    ipcMain.removeHandler(desktopIpc.getSecurityScanHistory);
    ipcMain.removeHandler(desktopIpc.cancelSecurityScan);
    ipcMain.removeHandler(desktopIpc.getSecurityModelConfig);
    ipcMain.removeHandler(desktopIpc.setSecurityModelConfig);
    ipcMain.removeHandler(desktopIpc.getSecurityScanSchedule);
    ipcMain.removeHandler(desktopIpc.setSecurityScanSchedule);
    ipcMain.removeHandler(desktopIpc.getSecurityRuntimeCapability);
    void localWebServer?.close();
  });

  void app.whenReady().then(async () => {
    // Resolve the same interactive user's home in packaged builds. The explicit
    // value also keeps scanner behavior stable when Electron is launched by
    // Finder/login items with a reduced environment. A test-lab override, when
    // supplied, intentionally wins.
    process.env[ENV.USAGE_HOME] ??= app.getPath("home");

    const prefs = readPrefs(prefsPath());
    currentPreferences = resolveDesktopPreferences(prefs, app.getLocale());
    securityScanner = new SecurityScannerService({
      homeDirectory: process.env[ENV.USAGE_HOME] || app.getPath("home"),
      dataDirectory: join(
        process.env[ENV.USAGE_HOME] || app.getPath("home"),
        APP_DATA_DIR,
      ),
      locale: () => currentPreferences.locale,
      env: process.env,
      secretStorage: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
        decrypt: (value) =>
          safeStorage.decryptString(Buffer.from(value, "base64")),
      },
    });

    const compat = await checkDataCompatibility();
    if (!compat.compatible) {
      const dataIncompat =
        electronMessages[currentPreferences.locale].dialog.dataIncompat;
      const oldVer = compat.oldVersion ?? "?";
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: dataIncompat.title,
        message: interpolate(dataIncompat.message, {
          oldVer: oldVer.replace(/^v/i, ""),
          curVer: CURRENT_SCHEMA_VERSION,
        }),
        buttons: [dataIncompat.quit, dataIncompat.clearAndContinue],
      });

      if (response === 1) {
        // User chose to clear data and continue
        const homeDir = process.env[ENV.USAGE_HOME] || app.getPath("home");
        try {
          await unlink(join(homeDir, APP_DATA_DIR, "schema_version"));
        } catch {
          // File may not exist
        }
        try {
          await writeFile(
            join(homeDir, APP_DATA_DIR, "schema_version"),
            CURRENT_SCHEMA_VERSION,
            "utf8",
          );
        } catch {
          // Directory may not exist; proceed anyway
        }
      } else {
        app.quit();
        return;
      }
    }

    allowedOrigin = await resolveApplicationOrigin();
    await prewarmLocalData(allowedOrigin);
    registerIpcHandlers();
    rebuildTray();
    await createMainWindow();
    await scheduleAutomaticSecurityScan();
  });
}
