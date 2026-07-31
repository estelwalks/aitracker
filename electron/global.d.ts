import type { AITrackerDesktopApi } from "./contracts.js";

declare global {
  interface Window {
    desktopBridge?: AITrackerDesktopApi;
  }
}

export {};
