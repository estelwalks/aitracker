import type { SessionPage, SessionsModuleContract } from "../contracts.ts";

/** Browser-safe view model. Raw session storage and resume details stay server-side. */
export type SessionsViewModel = SessionsModuleContract | SessionPage;
export { SessionDetailPage } from "./SessionDetailPage.tsx";
export { SessionsPage } from "./SessionsPage.tsx";
export { ChatHistorySidebar } from "./ChatHistorySidebar.tsx";
export { TranscriptPanel } from "./TranscriptPanel.tsx";
