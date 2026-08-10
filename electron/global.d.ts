import type { DesktopApi } from "./contracts.js";

declare global {
  interface Window {
    desktopApi?: DesktopApi;
  }
}

export {};
