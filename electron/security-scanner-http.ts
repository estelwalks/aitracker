import { createRequire } from "node:module";

import type { FetchLike } from "@estelwalks/agent-threat-scanner";

import { APP_NAME } from "./app-config.js";

const require = createRequire(import.meta.url);
const APP_REPO_URL = "https://github.com/estelwalks/aitracker";

interface RootPackageJson {
  readonly version?: unknown;
}

function applicationVersion(): string {
  let packageJson: RootPackageJson;
  try {
    // Source/tests run from electron/, while the compiled Electron bundle is
    // emitted to build/electron/. These two paths both resolve the root file.
    packageJson = require("../package.json") as RootPackageJson;
  } catch {
    packageJson = require("../../package.json") as RootPackageJson;
  }
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    throw new Error("Root package.json must define a non-empty version");
  }
  return packageJson.version;
}

export function securityScannerUserAgent(): string {
  return `${APP_NAME}/${applicationVersion()} (Electron; +${APP_REPO_URL})`;
}

export function createSecurityScannerFetch(
  fetcher: typeof fetch = fetch,
): FetchLike {
  return (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("User-Agent", securityScannerUserAgent());
    const normalizedHeaders: Record<string, string> = {};
    headers.forEach((value, key) => {
      normalizedHeaders[key] = value;
    });
    return fetcher(input, {
      ...init,
      headers: normalizedHeaders,
    });
  };
}
