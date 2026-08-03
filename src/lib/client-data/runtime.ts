import {
  createBrowserMockClientDataSource,
  type BrowserMockClientDataSourceOptions,
} from "./mock";
import type { ClientDataRuntime, ClientDataSource } from "./types";

const globalSourceKey = "__TRUSTTOOLS_CLIENT_DATA_SOURCE__";

type ClientDataGlobal = typeof globalThis & {
  [globalSourceKey]?: ClientDataSource;
};

export type ResolveClientDataSourceOptions = {
  runtime?: ClientDataRuntime | "auto";
  source?: ClientDataSource;
  mock?: BrowserMockClientDataSourceOptions;
};

let configuredSource: ClientDataSource | undefined;
let defaultSource: ClientDataSource | undefined;

function globalSource() {
  return (globalThis as ClientDataGlobal)[globalSourceKey];
}

function detectRuntime(): ClientDataRuntime {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  if (
    typeof process !== "undefined" &&
    typeof process.versions?.electron === "string"
  ) {
    return "electron";
  }

  if (
    typeof process !== "undefined" &&
    typeof process.versions?.node === "string"
  ) {
    return "node";
  }

  return "unknown";
}

function missingAdapterError(runtime: ClientDataRuntime) {
  return new Error(
    `No TrustTools client data adapter is registered for the ${runtime} runtime`,
  );
}

export function setClientDataSource(source: ClientDataSource) {
  configuredSource = source;
  defaultSource = source;
  return source;
}

export function exposeClientDataSource(source: ClientDataSource) {
  (globalThis as ClientDataGlobal)[globalSourceKey] = source;
  defaultSource = source;
  return source;
}

export function clearClientDataSource() {
  configuredSource = undefined;
  defaultSource = undefined;
  delete (globalThis as ClientDataGlobal)[globalSourceKey];
}

export function resolveClientDataSource(
  options: ResolveClientDataSourceOptions = {},
): ClientDataSource {
  if (options.source) {
    return options.source;
  }

  if (configuredSource) {
    return configuredSource;
  }

  const injectedSource = globalSource();
  if (injectedSource) {
    return injectedSource;
  }

  const runtime =
    options.runtime && options.runtime !== "auto"
      ? options.runtime
      : detectRuntime();

  if (runtime === "browser" || runtime === "unknown") {
    return createBrowserMockClientDataSource(options.mock);
  }

  throw missingAdapterError(runtime);
}

export function getClientDataSource(
  options: ResolveClientDataSourceOptions = {},
) {
  defaultSource ??= resolveClientDataSource(options);
  return defaultSource;
}
