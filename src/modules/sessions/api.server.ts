import type { SessionPage, SessionsModuleContract } from "./contracts.ts";

/** Server transport DTO boundary; implementations must call the application port. */
export type SessionsApiResponse = SessionsModuleContract | SessionPage;
