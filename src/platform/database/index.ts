// Browser-safe database contracts only (Story S-01). Node implementations
// (DatabaseHost, capability probe, node:sqlite adapter) are server-only and
// must be imported from their `*.server.ts` paths directly.
export * from "./contracts.ts";
