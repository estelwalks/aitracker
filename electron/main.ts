import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
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
  powerMonitor,
  safeStorage,
  shell,
  screen,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";

import {
  desktopAppRoutes,
  desktopIpc,
  type AutoLaunchState,
  type DesktopAppRoute,
  type RuntimeInfo,
  type SecurityScanHistoryEntry,
  type SecurityScanSchedule,
  type SecurityScanState,
} from "./contracts.js";
import {
  createAutomaticSecurityScanScheduler,
  type AutomaticSecurityScanAttempt,
  type AutomaticSecurityScanScheduler,
} from "./automatic-security-scan-scheduler.js";
import {
  createMacWidgetTrayTemplate,
  createTrayTemplate,
  electronMessages,
  interpolate,
  mapSystemCurrency,
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
} from "./prefs.js";
import { APP_NAME, ENV } from "./app-config.js";
import { SecurityScannerService } from "./security-scanner-service.js";
import { isTrustedIpcSender } from "./ipc-security.js";
import { DesktopStateBroker } from "./desktop-state-broker.js";
import { createStartupDocument } from "./startup-screen.js";
import { startupFailureDialogMessage } from "./startup-failure.js";
import { resolveMainWindowSize } from "./main-window-size.js";
import {
  normalizeTrayTitle,
  persistTrayTitleBestEffort,
  readTrayPreferencesBestEffort,
  TRAY_TITLE_PLACEHOLDER,
  TRAY_TITLE_PREF_KEY,
  updateTrayTitleIfChanged,
} from "./tray-title.js";
import { findTrayIconPath, TRAY_ICON_DATA_URL } from "./tray-icon.js";
import {
  completeReleaseDataResetAfterWarmup,
  prepareReleaseDataReset,
} from "./release-data-reset.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const developmentUrl = process.env[ENV.DEV_URL];
const isDevelopment = Boolean(developmentUrl);
/**
 * A self-contained first frame shown while the local server and persisted
 * desktop preferences are starting. Loading this document is intentionally
 * independent of the HTTP application origin: a cold start must never leave
 * a featureless black BrowserWindow while a route loader is running.
 */
const processStartedAt = performance.now();

/** Emits duration-only milestones; no paths, session data, or preferences. */
function reportStartupMilestone(name: string): void {
  console.info(
    `[performance] startup.${name}=${Math.round(performance.now() - processStartedAt)}ms`,
  );
}

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localWebServer: LocalWebServer | null = null;
let allowedOrigin = "";
let isQuitting = false;
let securityScanner: SecurityScannerService | null = null;
let automaticSecurityScanScheduler: AutomaticSecurityScanScheduler | null =
  null;
let desktopStateBroker: DesktopStateBroker | null = null;
let startupDocument = "";
let currentTrayTitle = TRAY_TITLE_PLACEHOLDER;
/** Resolved at startup: manual preference > system mapping > fallback. */
let currentPreferences: LocalePreferences = {
  locale: "zh-CN",
  localeSource: "fallback",
  displayCurrency: "USD",
  currencySource: "fallback",
};

async function hasCloseHintBeenShown(): Promise<boolean> {
  if (!desktopStateBroker) throw new Error("Desktop state broker unavailable");
  return (await desktopStateBroker.preferences()).closeHintShown === true;
}

async function markCloseHintShown(): Promise<void> {
  if (!desktopStateBroker) throw new Error("Desktop state broker unavailable");
  await desktopStateBroker.setPreference("closeHintShown", true);
}

/**
 * WebContents ids allowed to invoke IPC handlers: the main window plus the
 * floating widget window (created lazily). Both load the same sandboxed
 * preload and run same-origin pages, so they share the trusted-sender set.
 */
function trustedWebContentsIds(): number[] {
  const ids: number[] = [];
  if (mainWindow && !mainWindow.isDestroyed()) {
    ids.push(mainWindow.webContents.id);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    ids.push(widgetWindow.webContents.id);
  }
  return ids;
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const mainFrame = event.sender.mainFrame;
  if (
    !event.senderFrame ||
    !mainFrame ||
    // The window-level membership check is done here (multiple windows are
    // allowed); `isTrustedIpcSender` then re-verifies frame identity and the
    // same-origin URL against `allowedOrigin`.
    !trustedWebContentsIds().includes(event.sender.id) ||
    !isTrustedIpcSender({
      senderWebContentsId: event.sender.id,
      expectedWebContentsId: event.sender.id,
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
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (process.platform === "darwin") {
    app.dock?.show();
    // Temporarily expose the client on every Space so showing it from a
    // menu-bar widget brings it onto the user's current desktop.
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();

  if (process.platform === "darwin") {
    mainWindow.setVisibleOnAllWorkspaces(false, { visibleOnFullScreen: true });
  }
}

function openMainWindowRoute(
  route: DesktopAppRoute,
  section?: "menu-bar-app",
): void {
  if (!mainWindow || mainWindow.isDestroyed() || !allowedOrigin) return;
  widgetWindow?.hide();
  const sectionQuery = section ? `section=${section}&` : "";
  const path = `${route}?${sectionQuery}locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
  const url = localWebServer
    ? localWebServer.createBrowserBootstrapUrl(path)
    : `${allowedOrigin}${path}`;
  void mainWindow
    .loadURL(url)
    .then(showMainWindow)
    .catch((error: unknown) =>
      console.warn("AITracker main-window navigation failed", error),
    );
}

/**
 * Show the floating widget window (420×680, frameless, always-on-top, hidden
 * from the taskbar/dock). Created lazily on first use and reused afterwards:
 * closing hides it instead of destroying it so widget state/prefs survive.
 * Security hardening mirrors the main window: sandboxed preload, same-origin
 * navigation guard and external links handed to the OS browser.
 */
async function showWidgetWindow(
  trayBounds?: Electron.Rectangle,
): Promise<void> {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    if (widgetWindow.isMinimized()) widgetWindow.restore();
    positionWidgetWindow(trayBounds);
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 420,
    height: 680,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: join(currentDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Position only after BrowserWindow exists. On macOS, positioning before
  // ready-to-show can be overwritten by the native window restoration logic.
  positionWidgetWindow(trayBounds);

  if (process.platform === "darwin") {
    // macOS 菜单栏小组件惯例：浮于所有桌面空间（含全屏 Space）之上。
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    widgetWindow.setAlwaysOnTop(true, "floating");
  }

  widgetWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  widgetWindow.webContents.on("will-navigate", (event, url) => {
    if (
      !url.startsWith("data:text/html;base64,") &&
      new URL(url).origin !== allowedOrigin
    ) {
      event.preventDefault();
    }
  });

  widgetWindow.on("blur", () => {
    if (process.platform === "darwin" && !isQuitting) {
      widgetWindow?.hide();
    }
  });
  widgetWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();
    widgetWindow?.hide();
  });
  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });

  const widgetUrl = localWebServer
    ? localWebServer.createBrowserBootstrapUrl(
        `/widget?mode=float&locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`,
      )
    : `${allowedOrigin}/widget?mode=float&locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
  try {
    // Load the real route before revealing the window. Showing the standalone
    // shell first caused a visible second transition from the loading mock to
    // the styled widget, especially on the first menu-bar click.
    await widgetWindow.loadURL(widgetUrl);
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    await waitForWidgetStyles(widgetWindow);
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    positionWidgetWindow(trayBounds);
    widgetWindow.show();
    widgetWindow.focus();
  } catch (error) {
    console.warn("Widget window failed to load", error);
    widgetWindow?.destroy();
  }
}

/** macOS 菜单栏入口只负责切换浮窗，不附带其他菜单操作。 */
async function toggleWidgetWindow(
  trayBounds: Electron.Rectangle,
): Promise<void> {
  if (widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()) {
    widgetWindow.hide();
    return;
  }
  await showWidgetWindow(trayBounds);
}

function positionWidgetWindow(trayBounds?: Electron.Rectangle): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const display =
    process.platform === "darwin" && trayBounds
      ? screen.getDisplayNearestPoint({
          x: trayBounds.x,
          y: trayBounds.y,
        })
      : screen.getPrimaryDisplay();
  const { x, y, width, height } = display.workArea;
  const [windowWidth, windowHeight] = widgetWindow.getSize();
  const gap = 6;
  const preferredX = trayBounds
    ? trayBounds.x + Math.round((trayBounds.width - windowWidth) / 2)
    : x + width - windowWidth - 12;
  const preferredY = trayBounds
    ? trayBounds.y + trayBounds.height + gap
    : y + 8;
  const positionX = Math.min(
    Math.max(preferredX, x + 8),
    x + width - windowWidth - 8,
  );
  const positionY = trayBounds
    ? Math.min(Math.max(preferredY, y + 8), y + height - windowHeight - 8)
    : preferredY;
  widgetWindow.setPosition(positionX, positionY, false);
}

/**
 * `loadURL()` resolves after the document is available, not after the lazy
 * widget chunk and its CSS have painted. Waiting for the real card's computed
 * styles prevents Electron from revealing the transparent window for one
 * frame with unstyled text on a black compositor surface.
 */
async function waitForWidgetStyles(window: BrowserWindow): Promise<void> {
  await window.webContents
    .executeJavaScript(
      `(() => new Promise((resolve) => {
        const deadline = performance.now() + 1800;
        const check = () => {
          const card = document.querySelector('.aitracker-glass-overview');
          if (card) {
            const style = getComputedStyle(card);
            if (style.display === 'flex' && style.borderRadius === '30px') {
              requestAnimationFrame(() => requestAnimationFrame(resolve));
              return;
            }
          }
          if (performance.now() >= deadline) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        check();
      }))()`,
      true,
    )
    .catch(() => undefined);
}

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

async function runAutomaticSecurityScan(
  schedule?: SecurityScanSchedule,
): Promise<AutomaticSecurityScanAttempt> {
  const scanner = securityScanner;
  if (!scanner) return "failed";
  const status = scanner.getStatus().status;
  if (status === "running" || status === "cancelling") return "busy";
  let state: SecurityScanState;
  try {
    state = await scanner.startAutomaticScan(schedule);
  } catch (error) {
    // No discovered Skills, a narrowed scope with no matches, and transient
    // local failures are recoverable automatic passes. Keep the next run
    // alive, but leave a stable local diagnostic instead of silently making
    // the schedule appear broken.
    const reason = error instanceof Error ? error.message : "unknown";
    console.warn(`[security] automatic scan skipped: ${reason}`);
    return "failed";
  }
  if (schedule?.notify === true) {
    void notifyIfAutomaticScanFoundRisks(scanner, state.scanId);
  }
  return "started";
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

function suspendAutomaticSecurityScan(): void {
  automaticSecurityScanScheduler?.suspend();
}

function resumeAutomaticSecurityScan(): void {
  void automaticSecurityScanScheduler?.resume();
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
    openMainWindowRoute("/");
  });
  ipcMain.handle(desktopIpc.openWindowRoute, (event, route: unknown): void => {
    assertTrustedSender(event);
    if (!desktopAppRoutes.includes(route as DesktopAppRoute)) {
      throw new TypeError("Unsupported desktop app route");
    }
    openMainWindowRoute(route as DesktopAppRoute);
  });
  ipcMain.handle(desktopIpc.openWidgetWindow, (event): void => {
    assertTrustedSender(event);
    void showWidgetWindow();
  });
  ipcMain.handle(
    desktopIpc.setTrayTitle,
    async (event, title: unknown): Promise<void> => {
      assertTrustedSender(event);
      if (process.platform !== "darwin" || !tray) return;
      const nextTitle = normalizeTrayTitle(title);
      if (nextTitle == null) throw new TypeError("Tray title required");
      currentTrayTitle = nextTitle;
      updateTrayTitleIfChanged(tray, nextTitle);
      const broker = desktopStateBroker;
      if (broker) {
        void persistTrayTitleBestEffort(
          (value) => broker.setPreference(TRAY_TITLE_PREF_KEY, value),
          nextTitle,
          (error) =>
            console.warn("AITracker tray title cache write failed", error),
        );
      }
    },
  );
  ipcMain.handle(desktopIpc.windowMinimize, (event): void => {
    assertTrustedSender(event);
    mainWindow?.minimize();
  });
  ipcMain.handle(desktopIpc.windowToggleMaximize, (event): boolean => {
    assertTrustedSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return mainWindow.isMaximized();
  });
  ipcMain.handle(desktopIpc.windowClose, (event): void => {
    assertTrustedSender(event);
    // 复用现有 close 拦截：隐藏到托盘（而非真正退出）。
    mainWindow?.close();
  });
  ipcMain.handle(desktopIpc.windowIsMaximized, (event): boolean => {
    assertTrustedSender(event);
    return Boolean(
      mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized(),
    );
  });

  ipcMain.handle(
    desktopIpc.getPreferences,
    async (event): Promise<Record<string, unknown>> => {
      assertTrustedSender(event);
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      return desktopStateBroker.preferences();
    },
  );

  ipcMain.handle(
    desktopIpc.setPreference,
    async (event, key: unknown, value: unknown): Promise<void> => {
      assertTrustedSender(event);
      if (typeof key !== "string" || key.length === 0)
        throw new TypeError("Preference key required");
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      await desktopStateBroker.setPreference(key, value);
    },
  );
  ipcMain.handle(
    desktopIpc.resetPreferences,
    async (event): Promise<{ removedKeys: number }> => {
      assertTrustedSender(event);
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      const result = await desktopStateBroker.resetPreferences();
      await securityScanner?.clear();
      return result;
    },
  );

  ipcMain.handle(desktopIpc.getLocale, (event): DesktopLocale => {
    assertTrustedSender(event);
    return currentPreferences.locale;
  });

  ipcMain.handle(
    desktopIpc.setLocale,
    async (event, locale: unknown): Promise<void> => {
      assertTrustedSender(event);
      // Legacy manual shortcut — pins the manual locale mode.
      const next = normalizeDesktopLocale(locale);
      if (next == null) {
        // IPC 不接受任意 locale — only the four supported values.
        throw new TypeError("Unsupported locale");
      }
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      const prefs = await desktopStateBroker.preferences();
      prefs[LOCALE_MODE_PREF_KEY] = "manual";
      prefs[LOCALE_PREF_KEY] = next;
      await applyPreferences(prefs);
    },
  );

  ipcMain.handle(
    desktopIpc.getLocalePreferences,
    (event): LocalePreferences => {
      assertTrustedSender(event);
      return currentPreferences;
    },
  );

  ipcMain.handle(
    desktopIpc.setLocaleMode,
    async (event, mode: unknown, locale: unknown): Promise<void> => {
      assertTrustedSender(event);
      if (mode !== "system" && mode !== "manual") {
        throw new TypeError("Unsupported preference mode");
      }
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      const prefs = await desktopStateBroker.preferences();
      prefs[LOCALE_MODE_PREF_KEY] = mode;
      const nextLocale =
        mode === "manual"
          ? (normalizeDesktopLocale(locale) ?? currentPreferences.locale)
          : resolveDesktopPreferences(prefs, app.getLocale()).locale;
      if (mode === "manual") {
        const next = normalizeDesktopLocale(locale);
        if (next == null) throw new TypeError("Unsupported locale");
        prefs[LOCALE_PREF_KEY] = next;
      }
      // Match the renderer's language-change policy: changing language also
      // pins the corresponding display currency once, in the same IPC turn.
      prefs[CURRENCY_MODE_PREF_KEY] = "manual";
      prefs[CURRENCY_PREF_KEY] = mapSystemCurrency(nextLocale);
      await applyPreferences(prefs);
    },
  );

  ipcMain.handle(
    desktopIpc.setCurrencyMode,
    async (event, mode: unknown, currency: unknown): Promise<void> => {
      assertTrustedSender(event);
      if (mode !== "system" && mode !== "manual") {
        throw new TypeError("Unsupported preference mode");
      }
      if (!desktopStateBroker)
        throw new Error("Desktop state broker unavailable");
      const prefs = await desktopStateBroker.preferences();
      prefs[CURRENCY_MODE_PREF_KEY] = mode;
      if (mode === "manual") {
        const next = normalizeDesktopCurrency(currency);
        if (next == null) throw new TypeError("Unsupported currency");
        prefs[CURRENCY_PREF_KEY] = next;
      }
      await applyPreferences(prefs);
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
      const state = await securityScanner.start(request);
      return state;
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
  ipcMain.handle(desktopIpc.getSecurityScanSchedule, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getScanSchedule();
  });
  ipcMain.handle(desktopIpc.getSecurityScanScheduleStatus, async (event) => {
    assertTrustedSender(event);
    if (!securityScanner) throw new Error("Security scanner is unavailable");
    return securityScanner.getScanScheduleStatus();
  });
  ipcMain.handle(
    desktopIpc.setSecurityScanSchedule,
    async (event, schedule: unknown) => {
      assertTrustedSender(event);
      if (!securityScanner) throw new Error("Security scanner is unavailable");
      const result = await securityScanner.setScanSchedule(schedule);
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
async function applyPreferences(prefs: Record<string, unknown>): Promise<void> {
  if (!desktopStateBroker) throw new Error("Desktop state broker unavailable");
  for (const [key, value] of Object.entries(prefs)) {
    await desktopStateBroker.setPreference(key, value);
  }
  const resolved = resolveDesktopPreferences(prefs, app.getLocale());
  const localeChanged = resolved.locale !== currentPreferences.locale;
  currentPreferences = resolved;
  if (localeChanged) rebuildTray();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(desktopIpc.localeChanged, resolved.locale);
    mainWindow.webContents.send(desktopIpc.preferencesChanged, resolved);
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.webContents.send(desktopIpc.localeChanged, resolved.locale);
    widgetWindow.webContents.send(desktopIpc.preferencesChanged, resolved);
  }
}

/**
 * (Re)build the tray icon and its context menu in the current locale.
 * Language switches destroy and recreate the menu so labels and the
 * auto-launch checkbox state stay in sync.
 */
function rebuildTray(): void {
  const trayIconPath = findTrayIconPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  // Both platforms use the full-color supplied logo. Retain a PNG fallback if
  // the native resource is unavailable or corrupt.
  let trayIcon = trayIconPath
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  if (trayIcon.isEmpty()) {
    trayIcon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  }

  const autoLaunch = getAutoLaunchState();
  const template: TrayTemplateItem[] = createTrayTemplate(
    currentPreferences.locale,
    {
      autoLaunchEnabled: autoLaunch.enabled,
      autoLaunchSupported: autoLaunch.supported,
    },
    {
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
  if (process.platform === "darwin") {
    // Use the persisted last-known compact summary immediately. A new install
    // gets only a low-noise placeholder until the first read model arrives.
    tray.setTitle(currentTrayTitle);
    const macMenu = Menu.buildFromTemplate(
      createMacWidgetTrayTemplate(currentPreferences.locale, {
        onOpenDashboard: () => openMainWindowRoute("/"),
        onOpenSettings: () => openMainWindowRoute("/settings", "menu-bar-app"),
        onQuit: () => {
          isQuitting = true;
          app.quit();
        },
      }) as Electron.MenuItemConstructorOptions[],
    );
    tray.on("right-click", () => tray?.popUpContextMenu(macMenu));
  } else {
    tray.setContextMenu(
      Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]),
    );
  }
  tray.on("click", (_event, bounds) => {
    if (process.platform === "darwin") {
      void toggleWidgetWindow(bounds);
      return;
    }
    showMainWindow();
  });
}

async function createMainWindow(): Promise<void> {
  const mainWindowSize = resolveMainWindowSize();
  mainWindow = new BrowserWindow({
    ...mainWindowSize,
    // 无边框 + 自绘标题栏：隐藏系统原生标题栏与窗口按钮，由渲染进程
    // 提供与主题一致的深色标题栏（macOS 保留原生红绿灯按钮）。
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    autoHideMenuBar: true,
    // 立即显示窗口（深色底避免白屏闪烁）：首次完整扫描可能耗时较久，
    // 等待 ready-to-show 会让用户以为应用没有启动。
    show: true,
    backgroundColor: "#0b0b10",
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
    if (url !== startupDocument && new URL(url).origin !== allowedOrigin) {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", showMainWindow);
  const broadcastMaximized = (maximized: boolean) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(desktopIpc.windowMaximizedChanged, maximized);
  };
  mainWindow.on("maximize", () => broadcastMaximized(true));
  mainWindow.on("unmaximize", () => broadcastMaximized(false));
  mainWindow.on("close", async (event) => {
    if (isQuitting) {
      return;
    }
    event.preventDefault();

    if (!(await hasCloseHintBeenShown())) {
      const closeHint =
        electronMessages[currentPreferences.locale].dialog.closeHint;
      await dialog.showMessageBox(mainWindow!, {
        message: closeHint.message,
        buttons: [closeHint.ok],
      });
      await markCloseHintShown();
    }

    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // This local document gives immediate visual feedback. The application URL
  // is loaded separately once the local server and preference store are ready.
  startupDocument = createStartupDocument(currentPreferences.locale);
  await mainWindow.loadURL(startupDocument);
  reportStartupMilestone("startup-screen-ready");
}

async function loadMainWindow(): Promise<void> {
  if (!mainWindow || !allowedOrigin) return;
  const appUrl = localWebServer
    ? localWebServer.createBrowserBootstrapUrl(
        `/?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`,
      )
    : `${allowedOrigin}?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
  mainWindow.webContents.once("did-finish-load", () => {
    reportStartupMilestone("application-document-ready");
  });
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
      void createMainWindow().then(() => loadMainWindow());
    }
  });
  app.on("will-quit", () => {
    automaticSecurityScanScheduler?.stop();
    powerMonitor.removeListener("suspend", suspendAutomaticSecurityScan);
    powerMonitor.removeListener("resume", resumeAutomaticSecurityScan);
    ipcMain.removeHandler(desktopIpc.getRuntimeInfo);
    ipcMain.removeHandler(desktopIpc.getAutoLaunch);
    ipcMain.removeHandler(desktopIpc.setAutoLaunch);
    ipcMain.removeHandler(desktopIpc.showWindow);
    ipcMain.removeHandler(desktopIpc.openWindowRoute);
    ipcMain.removeHandler(desktopIpc.openWidgetWindow);
    ipcMain.removeHandler(desktopIpc.setTrayTitle);
    ipcMain.removeHandler(desktopIpc.windowMinimize);
    ipcMain.removeHandler(desktopIpc.windowToggleMaximize);
    ipcMain.removeHandler(desktopIpc.windowClose);
    ipcMain.removeHandler(desktopIpc.windowIsMaximized);
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
    ipcMain.removeHandler(desktopIpc.getSecurityScanSchedule);
    ipcMain.removeHandler(desktopIpc.getSecurityScanScheduleStatus);
    ipcMain.removeHandler(desktopIpc.setSecurityScanSchedule);
    ipcMain.removeHandler(desktopIpc.getSecurityRuntimeCapability);
    void localWebServer?.close();
  });

  void app
    .whenReady()
    .then(async () => {
      if (process.platform === "darwin") app.dock?.show();
      app.on("activate", () => {
        if (mainWindow && !mainWindow.isDestroyed()) showMainWindow();
        else void createMainWindow();
      });
      reportStartupMilestone("electron-ready");
      powerMonitor.on("suspend", suspendAutomaticSecurityScan);
      powerMonitor.on("resume", resumeAutomaticSecurityScan);
      // Resolve the same interactive user's home in packaged builds. The explicit
      // value also keeps scanner behavior stable when Electron is launched by
      // Finder/login items with a reduced environment. A test-lab override, when
      // supplied, intentionally wins.
      process.env[ENV.USAGE_HOME] ??= app.getPath("home");
      process.env[ENV.DESKTOP_BROKER_TOKEN] ??= randomUUID();
      desktopStateBroker = new DesktopStateBroker({
        origin: () => allowedOrigin,
        capabilityToken: () => localWebServer?.capabilityToken,
      });
      currentPreferences = resolveDesktopPreferences({}, app.getLocale());
      securityScanner = new SecurityScannerService({
        homeDirectory: process.env[ENV.USAGE_HOME] || app.getPath("home"),
        locale: () => currentPreferences.locale,
        env: process.env,
        secretStorage: {
          isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
          encrypt: (value) =>
            safeStorage.encryptString(value).toString("base64"),
          decrypt: (value) =>
            safeStorage.decryptString(Buffer.from(value, "base64")),
        },
        persistence: desktopStateBroker,
        onScheduleChanged: (schedule) =>
          automaticSecurityScanScheduler?.update(schedule),
      });
      automaticSecurityScanScheduler = createAutomaticSecurityScanScheduler({
        readSchedule: () => securityScanner!.getScanSchedule(),
        readRuntime: () => desktopStateBroker!.readScheduleRuntime(),
        writeRuntime: (runtime) =>
          desktopStateBroker!.writeScheduleRuntime(runtime),
        attempt: (schedule) => runAutomaticSecurityScan(schedule),
      });
      // 打包后的 Windows/Linux 去掉默认 File/Edit/View 菜单栏（标题栏已自绘，
      // 菜单栏既遮挡又难看）；开发模式与 macOS 保留：macOS 菜单在系统菜单栏，
      // 开发模式需要默认快捷键（DevTools/Reload）。
      if (process.platform !== "darwin" && app.isPackaged) {
        Menu.setApplicationMenu(null);
      }
      // Present a branded local frame before any server, SQLite, or route work.
      // This window does not need the application origin and therefore gives
      // feedback even on a truly cold start.
      await createMainWindow();
      const releaseDataReset = await prepareReleaseDataReset({
        platform: process.platform,
        isPackaged: app.isPackaged,
        appVersion: app.getVersion(),
        // Always use Electron's trusted interactive-user paths. In particular,
        // never use the test-lab usage-home override as a deletion target.
        homeDirectory: app.getPath("home"),
        userDataDirectory: app.getPath("userData"),
      });
      allowedOrigin = await resolveApplicationOrigin();
      reportStartupMilestone("local-server-ready");
      // Initialize an empty workspace while the native startup document remains
      // visible. Once persisted snapshots exist, stale collectors continue in
      // the background and the renderer opens from the last completed data.
      // This remains a lightweight internal request, not a duplicate render.
      if (localWebServer) {
        await completeReleaseDataResetAfterWarmup(
          releaseDataReset,
          async () => {
            await localWebServer!.warmup(
              process.env[ENV.DESKTOP_BROKER_TOKEN] ?? "",
            );
            reportStartupMilestone("workspace-warmup-completed");
          },
        );
      } else if (releaseDataReset.status === "pending") {
        // A destructive packaged reset may only be completed by the local
        // runtime warmup. Never mark it successful merely because an external
        // development URL happened to be configured in the environment.
        throw new Error(
          "AITracker release data reset requires local workspace warmup",
        );
      }
      const broker = desktopStateBroker;
      const persistedTrayState = await readTrayPreferencesBestEffort(
        () => broker.preferences(),
        (error) =>
          console.warn("AITracker desktop preferences unavailable", error),
      );
      const persistedPreferences = persistedTrayState.preferences;
      currentPreferences = resolveDesktopPreferences(
        persistedPreferences,
        app.getLocale(),
      );
      currentTrayTitle = persistedTrayState.title;
      await securityScanner.recoverInterruptedRuns();
      registerIpcHandlers();
      rebuildTray();
      // Let the renderer own the first document request. A second hidden SSR
      // request duplicates route-loader, hydration, and SQLite work precisely
      // when the visible page needs those resources most.
      await loadMainWindow();
      void automaticSecurityScanScheduler.start();
    })
    .catch((error: unknown) => {
      // A failure before BrowserWindow construction must not leave a headless
      // process holding the single-instance lock and making later launches look
      // like they do nothing.
      console.error("AITracker startup failed", error);
      const startupFailure =
        electronMessages[currentPreferences.locale].dialog.startupFailure;
      dialog.showErrorBox(
        startupFailure.title,
        startupFailureDialogMessage(startupFailure, error),
      );
      app.quit();
    });
}
