import type { TasksModuleContract } from "../contracts";
export interface TasksApplication {
  readonly contract: TasksModuleContract;
}

export type {
  JobRun,
  JobRunStatus,
  JobRunTrigger,
  TaskRun,
  TaskRunSummary,
  Schedule,
  TaskPreference,
  TaskPreferencesFile,
  TaskRunRepository,
  TaskPreferenceRepository,
} from "./task-storage.ts";
