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
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";

import {
  desktopIpc,
  type AutoLaunchState,
  type RuntimeInfo,
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

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const developmentUrl = process.env.TRUSTTOOLS_DEV_URL;
const isDevelopment = Boolean(developmentUrl);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localWebServer: LocalWebServer | null = null;
let allowedOrigin = "";
let capabilityToken = "";
let isQuitting = false;
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
  if (!event.senderFrame || event.senderFrame.url === "about:blank") {
    throw new Error("Untrusted IPC sender");
  }

  if (new URL(event.senderFrame.url).origin !== allowedOrigin) {
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
    (event): { removedKeys: number } => {
      assertTrustedSender(event);
      const current = readPrefs(prefsPath());
      const keys = Object.keys(current).filter(
        (key) => key === "closeHintShown" || key.startsWith("trusttools."),
      );
      for (const key of keys) delete current[key];
      writePrefs(prefsPath(), current);
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
    },
    {
      onOpen: showMainWindow,
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
    title: "TrustTools",
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

  const appUrl = capabilityToken
    ? `${allowedOrigin}?token=${capabilityToken}&locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`
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
  localWebServer = await startLocalWebServer(webRoot);
  capabilityToken = localWebServer.capabilityToken;
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
    const prewarmUrl = capabilityToken
      ? `${origin}/?token=${capabilityToken}&locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`
      : `${origin}/?locale=${currentPreferences.locale}&currency=${currentPreferences.displayCurrency}`;
    const response = await fetch(prewarmUrl, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(
        `TrustTools initial data scan returned HTTP ${response.status}`,
      );
    }
    await response.body?.cancel();
  } catch (error) {
    // Startup remains recoverable: the BrowserWindow request will retry the
    // same loaders, and visible-page polling continues refreshing afterwards.
    console.warn(
      "TrustTools initial data scan did not finish before launch",
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDataCompatibility(): Promise<{
  compatible: boolean;
  oldVersion?: string;
}> {
  const homeDir = process.env.TRUSTTOOLS_USAGE_HOME || app.getPath("home");
  const schemaVersionPath = join(homeDir, ".trusttools", "schema_version");

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
    void localWebServer?.close();
  });

  void app.whenReady().then(async () => {
    // Resolve the same interactive user's home in packaged builds. The explicit
    // value also keeps scanner behavior stable when Electron is launched by
    // Finder/login items with a reduced environment. A test-lab override, when
    // supplied, intentionally wins.
    process.env.TRUSTTOOLS_USAGE_HOME ??= app.getPath("home");

    const prefs = readPrefs(prefsPath());
    currentPreferences = resolveDesktopPreferences(prefs, app.getLocale());

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
        const homeDir =
          process.env.TRUSTTOOLS_USAGE_HOME || app.getPath("home");
        try {
          await unlink(join(homeDir, ".trusttools", "schema_version"));
        } catch {
          // File may not exist
        }
        try {
          await writeFile(
            join(homeDir, ".trusttools", "schema_version"),
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
  });
}
