import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";

import { desktopIpc, type AutoLaunchState, type RuntimeInfo } from "./contracts.js";
import { startLocalWebServer, type LocalWebServer } from "./local-web-server.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const developmentUrl = process.env.TRUSTTOOLS_DEV_URL;
const isDevelopment = Boolean(developmentUrl);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let localWebServer: LocalWebServer | null = null;
let allowedOrigin = "";
let isQuitting = false;

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!event.senderFrame || event.senderFrame.url === "about:blank") {
    throw new Error("Untrusted IPC sender");
  }

  if (new URL(event.senderFrame.url).origin !== allowedOrigin) {
    throw new Error("Untrusted IPC sender");
  }
}

function getAutoLaunchState(): AutoLaunchState {
  const supported = process.platform === "darwin" || process.platform === "win32";
  return {
    enabled: supported ? app.getLoginItemSettings({ path: process.execPath }).openAtLogin : false,
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
  ipcMain.handle(desktopIpc.setAutoLaunch, (event, enabled: unknown): AutoLaunchState => {
    assertTrustedSender(event);
    if (typeof enabled !== "boolean") {
      throw new TypeError("Auto-launch value must be a boolean");
    }
    return setAutoLaunch(enabled);
  });
  ipcMain.handle(desktopIpc.showWindow, (event): void => {
    assertTrustedSender(event);
    showMainWindow();
  });
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
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  await mainWindow.loadURL(allowedOrigin);
}

async function resolveApplicationOrigin(): Promise<string> {
  if (developmentUrl) {
    return new URL(developmentUrl).origin;
  }

  const webRoot = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(app.getAppPath(), ".output");
  localWebServer = await startLocalWebServer(webRoot);
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
    const response = await fetch(`${origin}/`, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn(`AITracker initial data scan returned HTTP ${response.status}`);
    }
    await response.body?.cancel();
  } catch (error) {
    // Startup remains recoverable: the BrowserWindow request will retry the
    // same loaders, and visible-page polling continues refreshing afterwards.
    console.warn("AITracker initial data scan did not finish before launch", error);
  } finally {
    clearTimeout(timeout);
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
    void localWebServer?.close();
  });

  void app.whenReady().then(async () => {
    // Resolve the same interactive user's home in packaged builds. The explicit
    // value also keeps scanner behavior stable when Electron is launched by
    // Finder/login items with a reduced environment. A test-lab override, when
    // supplied, intentionally wins.
    process.env.TRUSTTOOLS_USAGE_HOME ??= app.getPath("home");
    allowedOrigin = await resolveApplicationOrigin();
    await prewarmLocalData(allowedOrigin);
    registerIpcHandlers();
    createTray();
    await createMainWindow();
  });
}
