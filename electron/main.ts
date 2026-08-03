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
  startLocalWebServer,
  type LocalWebServer,
} from "./local-web-server.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const developmentUrl = process.env.TRUSTTOOLS_DEV_URL;
const isDevelopment = Boolean(developmentUrl);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localWebServer: LocalWebServer | null = null;
let allowedOrigin = "";
let capabilityToken = "";
let isQuitting = false;

const CURRENT_SCHEMA_VERSION = "v10";

function hasCloseHintBeenShown(): boolean {
  try {
    const raw = readFileSync(
      join(app.getPath("userData"), "trusttools-prefs.json"),
      "utf8",
    );
    const prefs = JSON.parse(raw) as Record<string, unknown>;
    return prefs.closeHintShown === true;
  } catch {
    return false;
  }
}

function markCloseHintShown(): void {
  const prefsPath = join(app.getPath("userData"), "trusttools-prefs.json");
  let current: Record<string, unknown> = {};
  try {
    const raw = readFileSync(prefsPath, "utf8");
    current = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // file doesn't exist or is invalid; start fresh
  }
  current.closeHintShown = true;
  const tmp = prefsPath + ".tmp." + Date.now();
  writeFileSync(tmp, JSON.stringify(current, null, 2), "utf8");
  renameSync(tmp, prefsPath);
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

  const prefsPath = join(app.getPath("userData"), "trusttools-prefs.json");

  ipcMain.handle(
    desktopIpc.getPreferences,
    (event): Record<string, unknown> => {
      assertTrustedSender(event);
      try {
        const raw = readFileSync(prefsPath, "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    },
  );

  ipcMain.handle(
    desktopIpc.setPreference,
    (event, key: unknown, value: unknown): void => {
      assertTrustedSender(event);
      if (typeof key !== "string" || key.length === 0)
        throw new TypeError("Preference key required");
      let current: Record<string, unknown> = {};
      try {
        const raw = readFileSync(prefsPath, "utf8");
        current = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // file doesn't exist or is invalid; start fresh
      }
      current[key] = value;
      const tmp = prefsPath + ".tmp." + Date.now();
      writeFileSync(tmp, JSON.stringify(current, null, 2), "utf8");
      renameSync(tmp, prefsPath);
    },
  );
}

function createTray(): void {
  const trayIconPath = app.isPackaged
    ? join(process.resourcesPath, "tray-icon.png")
    : join(app.getAppPath(), "build", "tray-icon.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath);
  if (process.platform === "darwin") {
    trayIcon.setTemplateImage(true);
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("AITracker");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 AITracker", click: showMainWindow },
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: getAutoLaunchState().enabled,
        enabled: getAutoLaunchState().supported,
        click: (menuItem) => {
          setAutoLaunch(menuItem.checked);
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
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
    title: "AITracker",
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
      await dialog.showMessageBox(mainWindow!, {
        message: "AITracker 将继续在菜单栏运行，可通过托盘图标重新打开",
        buttons: ["知道了"],
      });
      markCloseHintShown();
    }

    mainWindow?.hide();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  const appUrl = capabilityToken
    ? `${allowedOrigin}?token=${capabilityToken}`
    : allowedOrigin;
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
      ? `${origin}/?token=${capabilityToken}`
      : `${origin}/`;
    const response = await fetch(prewarmUrl, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(
        `AITracker initial data scan returned HTTP ${response.status}`,
      );
    }
    await response.body?.cancel();
  } catch (error) {
    // Startup remains recoverable: the BrowserWindow request will retry the
    // same loaders, and visible-page polling continues refreshing afterwards.
    console.warn(
      "AITracker initial data scan did not finish before launch",
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
    void localWebServer?.close();
  });

  void app.whenReady().then(async () => {
    // Resolve the same interactive user's home in packaged builds. The explicit
    // value also keeps scanner behavior stable when Electron is launched by
    // Finder/login items with a reduced environment. A test-lab override, when
    // supplied, intentionally wins.
    process.env.TRUSTTOOLS_USAGE_HOME ??= app.getPath("home");

    const compat = await checkDataCompatibility();
    if (!compat.compatible) {
      const oldVer = compat.oldVersion ?? "?";
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "数据版本不兼容",
        message: `检测到旧版本数据格式 (v${oldVer})，与当前版本 (${CURRENT_SCHEMA_VERSION}) 不兼容。建议备份 ~/.trusttools/ 目录后清除数据重新启动。`,
        buttons: ["退出", "清除数据并继续"],
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
    createTray();
    await createMainWindow();
  });
}
