import type { TrustToolsDesktopApi } from "./contracts.js";

declare global {
  interface Window {
    trustToolsDesktop?: TrustToolsDesktopApi;
  }
}

export {};
